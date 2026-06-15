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
  SupportIntent,
  SupportState,
} from "../types";

const SYSTEM_PROMPT = `You are a concise customer service assistant for Vape Wholesale USA.
Write short, useful replies. Do not invent order status, tracking numbers, policies, or ticket IDs.
If a tool result is provided, answer from that result. If the result is empty or failed, ask one concrete follow-up or offer to create a support ticket.
Keep replies under 60 words unless the user asks for detail.`;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ORDER_RE = /\b(?:order\s*#?\s*)?([0-9]{6,12})\b/i;

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
    customerEmail?: string;
    orderNumber?: string;
    zohoTicketId?: string;
  }> {
    const email = content.match(EMAIL_RE)?.[0];
    const orderNumber = content.match(ORDER_RE)?.[1];

    if (this.state.pendingAction === "collect_order_number") {
      if (!orderNumber) {
        return {
          content: "Please send your order number so I can check the status.",
          intent: "order_status",
          pendingAction: "collect_order_number",
        };
      }
      return this.answerOrderStatus(orderNumber);
    }

    if (this.state.pendingAction === "collect_email") {
      if (!email) {
        return {
          content: "Please send the email address we should use for the support ticket.",
          intent: "ticket",
          pendingAction: "collect_email",
        };
      }
      return this.answerTicket(email);
    }

    const intent = this.detectIntent(content);

    if (intent === "order_status") {
      if (!orderNumber) {
        return {
          content: "Please send your order number and I will check the latest status.",
          intent,
          pendingAction: "collect_order_number",
        };
      }
      return this.answerOrderStatus(orderNumber);
    }

    if (intent === "ticket") {
      if (!email) {
        return {
          content: "Please send your email address and I will create a support ticket.",
          intent,
          pendingAction: "collect_email",
        };
      }
      return this.answerTicket(email);
    }

    const faq = await searchFaq(this.env, content);
    if (faq.answer) {
      await this.logToolEvent("searchFaq", { query: content }, faq);
      return {
        content: await this.polishReply(content, `FAQ answer: ${faq.answer}`),
        intent: "faq",
        pendingAction: null,
      };
    }

    return {
      content: await this.polishReply(
        content,
        "No FAQ match was found. Ask one clarifying question or offer to create a support ticket.",
      ),
      intent: "other",
      pendingAction: null,
    };
  }

  private detectIntent(content: string): SupportIntent {
    const lower = content.toLowerCase();
    if (/(order|tracking|shipment|shipped|delivery|where.*package|status)/.test(lower)) {
      return "order_status";
    }
    if (/(ticket|support|agent|human|complaint|problem|issue|wrong|broken|missing|refund|return|cancel)/.test(lower)) {
      return "ticket";
    }
    return "faq";
  }

  private async answerOrderStatus(orderNumber: string) {
    const result = await lookupOrderStatus(this.env, orderNumber);
    await this.logToolEvent("getOrderStatus", { orderNumber }, result);

    const toolSummary = result.status
      ? `Order ${result.orderNumber} status is ${result.status}. Tracking numbers: ${
          result.trackingNumbers.length ? result.trackingNumbers.join(", ") : "none found"
        }.`
      : `No order was found for ${orderNumber}.`;

    return {
      content: await this.polishReply(`Order status for ${orderNumber}`, toolSummary),
      intent: "order_status" as const,
      pendingAction: null,
      orderNumber,
    };
  }

  private async answerTicket(email: string) {
    if (this.state.zohoTicketId) {
      return {
        content: `You already have an open ticket from this chat: ${this.state.zohoTicketId}.`,
        intent: "ticket" as const,
        pendingAction: null,
        customerEmail: email,
        zohoTicketId: this.state.zohoTicketId,
      };
    }

    const result = await createZohoTicket(this.env, {
      email,
      messages: this.state.messages,
    });
    await this.logToolEvent("createTicket", { email }, result);

    return {
      content: result.ticketId
        ? `I created a support ticket for ${email}. Ticket ID: ${result.ticketId}.`
        : result.message,
      intent: "ticket" as const,
      pendingAction: null,
      customerEmail: email,
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
      return extractAiText(response) || toolContext;
    } catch (error) {
      console.error("Workers AI response failed", error);
      return toolContext;
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
