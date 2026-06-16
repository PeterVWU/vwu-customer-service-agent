import { Agent, type Connection } from "agents";
import { lookupOrderStatus } from "../tools/magento";
import { searchFaq } from "../tools/faq";
import { createZohoTicket } from "../tools/zoho";
import type {
  ChatMessage,
  ClientMessage,
  Env,
  PendingAction,
  ServerMessage,
  SupportOutcome,
  SupportIntent,
  SupportState,
} from "../types";

const SYSTEM_PROMPT = `You are a concise customer service assistant for Vape Wholesale USA.
Write short, useful replies. Do not invent order status, tracking numbers, policies, or ticket IDs.
If a tool result is provided, answer from that result. If the result is empty or failed, ask one concrete follow-up or offer to create a support ticket.
Keep replies under 60 words unless the user asks for detail.`;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ORDER_RE = /\b(?:order\s*#?\s*)?([0-9]{6,12})\b/i;
const SHORT_DETAIL_RE = /^(agent|human|support|help|ticket|representative|person|call me|email me)$/i;

export class CustomerSupportAgent extends Agent<Env, SupportState> {
  initialState: SupportState = {
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Hi, how can I help with your order or support request?",
        createdAt: Date.now(),
      },
    ],
    pendingAction: null,
    updatedAt: Date.now(),
  };

  async onStart() {
    await this.sql`
      CREATE TABLE IF NOT EXISTS tool_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `;
  }

  async onConnect(connection: Connection) {
    this.send(connection, {
      type: "state",
      messages: this.state.messages,
      pendingAction: this.state.pendingAction,
    });
  }

  async healthCheck() {
    return {
      ok: true,
      agent: "CustomerSupportAgent",
      model: this.env.WORKERS_AI_CHAT_MODEL,
      messages: this.state.messages.length,
      updatedAt: this.state.updatedAt,
    };
  }

  async onMessage(connection: Connection, rawMessage: string) {
    let event: ClientMessage;
    try {
      event = JSON.parse(rawMessage) as ClientMessage;
    } catch {
      this.send(connection, { type: "error", message: "Invalid message." });
      return;
    }

    if (event.type === "reset") {
      this.setState({ ...this.initialState, updatedAt: Date.now() });
      this.send(connection, {
        type: "state",
        messages: this.state.messages,
        pendingAction: this.state.pendingAction,
      });
      return;
    }

    const content = event.content?.trim();
    if (!content) return;

    const userMessage = this.makeMessage("user", content);
    this.setState({
      ...this.state,
      messages: [...this.state.messages, userMessage],
      updatedAt: Date.now(),
    });
    this.broadcastJson({ type: "message", message: userMessage, pendingAction: this.state.pendingAction });

    this.broadcastJson({ type: "typing", value: true });
    try {
      const response = await this.handleSupportTurn(content);
      const assistantMessage = this.makeMessage("assistant", response.content);
      this.setState({
        ...this.state,
        messages: [...this.state.messages, assistantMessage],
        pendingAction: response.pendingAction,
        lastIntent: response.intent,
        issueType: response.issueType ?? this.state.issueType,
        issueSummary: response.issueSummary ?? this.state.issueSummary,
        lastOutcome: response.outcome,
        customerEmail: response.customerEmail ?? this.state.customerEmail,
        orderNumber: response.orderNumber ?? this.state.orderNumber,
        zohoTicketId: response.zohoTicketId ?? this.state.zohoTicketId,
        updatedAt: Date.now(),
      });
      this.broadcastJson({ type: "message", message: assistantMessage, pendingAction: this.state.pendingAction });
    } catch (error) {
      console.error("Support turn failed", error);
      this.send(connection, {
        type: "error",
        message: "I hit a problem while handling that. Please try again.",
      });
    } finally {
      this.broadcastJson({ type: "typing", value: false });
    }
  }

  private async handleSupportTurn(content: string): Promise<{
    content: string;
    intent: SupportIntent;
    pendingAction: PendingAction;
    outcome: SupportOutcome;
    issueType?: SupportIntent;
    issueSummary?: string;
    customerEmail?: string;
    orderNumber?: string;
    zohoTicketId?: string;
  }> {
    const email = content.match(EMAIL_RE)?.[0];
    const orderNumber = content.match(ORDER_RE)?.[1];

    if (this.state.pendingAction === "collect_order_number") {
      if (email && this.state.issueSummary) {
        return this.answerTicket(email, this.state.issueType || "order_status", this.state.issueSummary, orderNumber ?? this.state.orderNumber);
      }

      if (!orderNumber) {
        return {
          content: "Please send your order number so I can check the status.",
          intent: "order_status",
          pendingAction: "collect_order_number",
          outcome: "needs_order_number",
        };
      }
      return this.answerOrderStatus(orderNumber);
    }

    if (this.state.pendingAction === "collect_email") {
      if (!email) {
        return {
          content: "Please send the email address we should use for the support ticket.",
          intent: this.state.issueType || "ticket",
          pendingAction: "collect_email",
          outcome: "needs_email",
        };
      }
      return this.answerTicket(email, this.state.issueType || "ticket", this.state.issueSummary, orderNumber ?? this.state.orderNumber);
    }

    if (this.state.pendingAction === "collect_issue_detail") {
      const issueType = this.state.issueType || "human_support";
      if (!hasUsefulIssueDetail(content)) {
        return {
          content: "Please describe what happened so our team has enough detail to help.",
          intent: issueType,
          pendingAction: "collect_issue_detail",
          outcome: "needs_issue_detail",
          issueType,
        };
      }

      const issueSummary = summarizeIssue(content);
      if (email) return this.answerTicket(email, issueType, issueSummary, orderNumber ?? this.state.orderNumber);

      return {
        content: "Thanks. Please send your email address and I will create a support ticket with those details.",
        intent: issueType,
        pendingAction: "collect_email",
        outcome: "needs_email",
        issueType,
        issueSummary,
        orderNumber: orderNumber ?? this.state.orderNumber,
      };
    }

    const intent = this.detectIntent(content);

    if (intent === "order_status") {
      if (!orderNumber) {
        return {
          content: "Please send your order number and I will check the latest status.",
          intent,
          pendingAction: "collect_order_number",
          outcome: "needs_order_number",
        };
      }
      return this.answerOrderStatus(orderNumber);
    }

    if (isEscalationIntent(intent)) {
      if (!hasUsefulIssueDetail(content)) {
        return {
          content: "Please describe the issue so I can include the right details for our support team.",
          intent,
          pendingAction: "collect_issue_detail",
          outcome: "needs_issue_detail",
          issueType: intent,
        };
      }

      const issueSummary = summarizeIssue(content);
      if (!email) {
        return {
          content: "Please send your email address and I will create a support ticket with those details.",
          intent,
          pendingAction: "collect_email",
          outcome: "needs_email",
          issueType: intent,
          issueSummary,
          orderNumber: orderNumber ?? this.state.orderNumber,
        };
      }
      return this.answerTicket(email, intent, issueSummary, orderNumber ?? this.state.orderNumber);
    }

    const faq = await this.answerFaq(content);
    if (faq.answer) {
      return {
        content: await this.polishReply(content, `FAQ answer: ${faq.answer}`),
        intent: "faq",
        pendingAction: null,
        outcome: "answered",
      };
    }

    if (this.state.pendingAction === "clarify_faq") {
      const issueSummary = summarizeIssue(content);
      if (email) return this.answerTicket(email, this.state.issueType || "other", issueSummary, orderNumber ?? this.state.orderNumber);

      return {
        content: "I still could not find a clear answer. Please send your email address and I will create a support ticket for our team.",
        intent: this.state.issueType || "other",
        pendingAction: "collect_email",
        outcome: "needs_email",
        issueType: this.state.issueType || "other",
        issueSummary,
      };
    }

    return {
      content: "Could you share a little more detail so I can check the right policy for you?",
      intent,
      pendingAction: "clarify_faq",
      outcome: "clarifying",
      issueType: intent === "faq" ? "other" : intent,
    };
  }

  private detectIntent(content: string): SupportIntent {
    const lower = content.toLowerCase();
    if (/(order|tracking|shipment|shipped|shipping|delivery|delivered|where.*package|status|processing|package)/.test(lower)) {
      return "order_status";
    }
    if (/(wrong|missing|damaged|broken|returned|return label|received someone|not correct|shorted|defective)/.test(lower)) {
      return "post_order_issue";
    }
    if (/(refund|return|exchange|cancel|cancellation)/.test(lower)) {
      return "returns_refunds";
    }
    if (/(payment|paid|charge|charged|declined|checkout|card|billing|transaction)/.test(lower)) {
      return "payment_checkout";
    }
    if (/(account|login|log in|password|verification|verify|id|wholesale|license|approved)/.test(lower)) {
      return "account_verification";
    }
    if (/(reward|points|discount|coupon|promo|store credit)/.test(lower)) {
      return "rewards_credit";
    }
    if (/(ticket|support|agent|human|representative|person|complaint|problem|issue|call|phone|email)/.test(lower)) {
      return "human_support";
    }
    return "faq";
  }

  private async answerFaq(content: string) {
    const faq = await searchFaq(this.env, content);
    await this.logToolEvent(
      "searchFaq",
      { query: content, intent: "faq", outcome: faq.answer ? "answered" : "not_found", score: faq.score },
      faq,
    );
    return faq;
  }

  private async answerOrderStatus(orderNumber: string) {
    const result = await lookupOrderStatus(this.env, orderNumber);
    await this.logToolEvent(
      "getOrderStatus",
      {
        orderNumber,
        intent: "order_status",
        outcome: result.error ? "tool_failed" : result.status ? "answered" : "not_found",
      },
      result,
    );

    if (result.error) {
      return {
        content:
          "I could not access the order system to check that order right now. Please send your email address and I will create a support ticket for our team to look it up.",
        intent: "order_status" as const,
        pendingAction: "collect_email" as const,
        outcome: "tool_failed" as const,
        issueType: "order_status" as const,
        issueSummary: `Order lookup failed for ${orderNumber}.`,
        orderNumber,
      };
    }

    if (!result.status) {
      return {
        content:
          "I could not find that order number. Please check the number and send it again, or send your email address and I will create a support ticket.",
        intent: "order_status" as const,
        pendingAction: "collect_order_number" as const,
        outcome: "not_found" as const,
        issueType: "order_status" as const,
        issueSummary: `Customer asked about order ${orderNumber}, but no order was found.`,
        orderNumber,
      };
    }

    const statusExplanation = explainOrderStatus(result.status, result.trackingNumbers);
    const trackingText = result.trackingNumbers.length
      ? `Tracking: ${result.trackingNumbers.join(", ")}.`
      : "No tracking number is available yet.";
    const escalationText = result.trackingNumbers.length
      ? "If the carrier has not updated for a while or the package was delivered but not received, send your email and I can create a ticket."
      : "If it has been processing longer than expected, send your email and I can create a ticket for our team to check it.";

    const toolSummary = `Order ${result.orderNumber}: ${statusExplanation} ${trackingText} ${escalationText}`;

    return {
      content: await this.polishReply(`Order status for ${orderNumber}`, toolSummary),
      intent: "order_status" as const,
      pendingAction: null,
      outcome: "answered" as const,
      orderNumber,
    };
  }

  private async answerTicket(
    email: string,
    issueType: SupportIntent = "ticket",
    issueSummary?: string,
    orderNumber?: string,
  ) {
    const ticketOrderNumber = orderNumber || this.state.orderNumber;

    if (this.state.zohoTicketId) {
      return {
        content: `You already have an open ticket from this chat: ${this.state.zohoTicketId}. Our support team will use it to review your request and follow up by email.`,
        intent: issueType,
        pendingAction: null,
        outcome: "ticket_existing" as const,
        issueType,
        issueSummary,
        customerEmail: email,
        orderNumber: ticketOrderNumber,
        zohoTicketId: this.state.zohoTicketId,
      };
    }

    const summary = issueSummary || summarizeConversation(this.state.messages);
    const result = await createZohoTicket(this.env, {
      email,
      messages: this.state.messages,
      issueType,
      orderNumber: ticketOrderNumber,
      summary,
    });
    await this.logToolEvent(
      "createTicket",
      {
        email,
        issueType,
        orderNumber: ticketOrderNumber,
        summary,
        outcome: result.ticketId ? "ticket_created" : "ticket_failed",
      },
      result,
    );

    return {
      content: result.ticketId
        ? `I created a support ticket for ${email}. Ticket ID: ${result.ticketId}. Our team will review the details and follow up by email.`
        : result.message,
      intent: issueType,
      pendingAction: null,
      outcome: result.ticketId ? ("ticket_created" as const) : ("ticket_failed" as const),
      issueType,
      issueSummary: summary,
      customerEmail: email,
      orderNumber: ticketOrderNumber,
      zohoTicketId: result.ticketId,
    };
  }

  private async polishReply(userMessage: string, toolContext: string): Promise<string> {
    try {
      const response = await this.env.AI.run(this.env.WORKERS_AI_CHAT_MODEL as keyof AiModels, {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Customer message: ${userMessage}\n\nContext: ${toolContext}` },
        ],
        max_tokens: 180,
      } as never);
      return cleanAssistantReply(extractAiText(response) || toolContext);
    } catch (error) {
      console.error("Workers AI response failed", error);
      return cleanAssistantReply(toolContext);
    }
  }

  private makeMessage(role: "user" | "assistant", content: string): ChatMessage {
    return {
      id: crypto.randomUUID(),
      role,
      content,
      createdAt: Date.now(),
    };
  }

  private send(connection: Connection, message: ServerMessage) {
    connection.send(JSON.stringify(message));
  }

  private broadcastJson(message: ServerMessage) {
    for (const connection of this.getConnections()) {
      this.send(connection, message);
    }
  }

  private async logToolEvent(name: string, input: unknown, output: unknown) {
    await this.sql`
      INSERT INTO tool_events (id, name, input, output, created_at)
      VALUES (${crypto.randomUUID()}, ${name}, ${JSON.stringify(input)}, ${JSON.stringify(output)}, ${Date.now()})
    `;
  }
}

function cleanAssistantReply(content: string): string {
  return content
    .replace(/^FAQ answer:\s*/i, "")
    .replace(/^No FAQ match was found\.\s*/i, "")
    .trim();
}

function isEscalationIntent(intent: SupportIntent): boolean {
  return (
    intent === "post_order_issue" ||
    intent === "returns_refunds" ||
    intent === "payment_checkout" ||
    intent === "account_verification" ||
    intent === "human_support"
  );
}

function hasUsefulIssueDetail(content: string): boolean {
  const normalized = content.trim();
  return normalized.length >= 12 && !SHORT_DETAIL_RE.test(normalized);
}

function summarizeIssue(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 240);
}

function summarizeConversation(messages: Array<{ role: string; content: string }>): string {
  const firstCustomerMessage = messages.find((message) => message.role === "user")?.content;
  return firstCustomerMessage ? summarizeIssue(firstCustomerMessage) : "Customer requested support from chat.";
}

function explainOrderStatus(status: string, trackingNumbers: string[]): string {
  const normalized = status.toLowerCase().replace(/[_-]+/g, " ");

  if (trackingNumbers.length) {
    return `The order status is ${status}, and a tracking number is available.`;
  }

  if (/(processing|pending|new|payment review)/.test(normalized)) {
    return `The order is currently ${status}, which usually means it is still being prepared or reviewed before shipment.`;
  }

  if (/(complete|shipped|closed)/.test(normalized)) {
    return `The order status is ${status}.`;
  }

  if (/(canceled|cancelled|hold|fraud)/.test(normalized)) {
    return `The order status is ${status}, so our support team may need to review it.`;
  }

  return `The order status is ${status}.`;
}

function extractAiText(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const value = response as {
    response?: string;
    output_text?: string;
    result?: string;
    choices?: Array<{ message?: { content?: string }; text?: string }>;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };

  return (
    value.response ||
    value.output_text ||
    value.result ||
    value.choices?.[0]?.message?.content ||
    value.choices?.[0]?.text ||
    value.output?.[0]?.content?.[0]?.text ||
    ""
  ).trim();
}
