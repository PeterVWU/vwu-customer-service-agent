import type { ChatMessage, Env, SupportIntent, TicketResult } from "../types";

interface CreateTicketInput {
  email: string;
  messages: ChatMessage[];
  issueType?: SupportIntent;
  orderNumber?: string;
  summary?: string;
}

export async function createZohoTicket(env: Env, input: CreateTicketInput): Promise<TicketResult> {
  const email = input.email.trim();
  if (!email) return { message: "Email is required to create a support ticket." };

  const accessToken = await env.ZOHO_OAUTH_WORKER.getAccessToken();
  const payload = buildTicketPayload(env, input);

  const response = await fetch(`${env.ZOHO_DESK_URL.replace(/\/$/, "")}/api/v1/tickets`, {
    method: "POST",
    headers: {
      orgId: env.ZOHO_ORG_ID,
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Zoho ticket creation failed", response.status, errorText);
    return { message: "I could not create the ticket right now. Please try again in a few minutes." };
  }

  const ticket = (await response.json()) as { id?: string; ticketNumber?: string };
  return {
    ticketId: ticket.ticketNumber || ticket.id,
    message: "Ticket created successfully.",
  };
}

function buildTicketPayload(env: Env, input: CreateTicketInput) {
  const recentMessages = input.messages
    .slice(-12)
    .map((message) => {
      const sender = message.role === "user" ? "Customer" : "Bot";
      return `<strong>${sender}:</strong> ${escapeHtml(message.content).replace(/\n/g, "<br>")}`;
    })
    .join("<br><br>");

  const firstUserMessage = input.messages.find((message) => message.role === "user")?.content;
  const summary = input.summary || firstUserMessage || "Customer Support Request";
  const subjectPrefix = input.issueType ? labelForIssueType(input.issueType) : "Chat";
  const subject = summary
    ? `${subjectPrefix}: ${summary.slice(0, 60)}${summary.length > 60 ? "..." : ""}`
    : "Customer Support Request";
  const context = [
    `<strong>Issue type:</strong> ${escapeHtml(input.issueType ? labelForIssueType(input.issueType) : "Unclassified")}`,
    input.orderNumber ? `<strong>Order number:</strong> ${escapeHtml(input.orderNumber)}` : "",
    `<strong>Summary:</strong> ${escapeHtml(summary)}`,
  ]
    .filter(Boolean)
    .join("<br>");

  return {
    subject,
    email: input.email,
    departmentId: env.ZOHO_DEPARTMENT_ID,
    contactId: env.ZOHO_CONTACT_ID,
    description: `<h3>Chat Support Context</h3><div>${context}</div><h3>Chat Conversation History</h3><div>${recentMessages}</div>`,
    priority: "Medium",
    status: "Open",
    channel: "Chat",
  };
}

function labelForIssueType(issueType: SupportIntent): string {
  const labels: Record<SupportIntent, string> = {
    faq: "FAQ",
    order_status: "Order status",
    post_order_issue: "Post-order issue",
    returns_refunds: "Returns/refunds",
    payment_checkout: "Payment/checkout",
    account_verification: "Account/verification",
    rewards_credit: "Rewards/store credit",
    human_support: "Human support",
    ticket: "Support ticket",
    other: "Other support",
  };

  return labels[issueType];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
