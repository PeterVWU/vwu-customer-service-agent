import type { ChatMessage, Env, TicketResult } from "../types";

interface CreateTicketInput {
  email: string;
  messages: ChatMessage[];
}

export async function createZohoTicket(env: Env, input: CreateTicketInput): Promise<TicketResult> {
  const email = input.email.trim();
  if (!email) return { message: "Email is required to create a support ticket." };

  const accessToken = await env.ZOHO_OAUTH_WORKER.getAccessToken();
  const payload = buildTicketPayload(env, email, input.messages);

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

function buildTicketPayload(env: Env, email: string, messages: ChatMessage[]) {
  const recentMessages = messages
    .slice(-12)
    .map((message) => {
      const sender = message.role === "user" ? "Customer" : "Bot";
      return `<strong>${sender}:</strong> ${escapeHtml(message.content).replace(/\n/g, "<br>")}`;
    })
    .join("<br><br>");

  const firstUserMessage = messages.find((message) => message.role === "user")?.content;
  const subject = firstUserMessage
    ? `${firstUserMessage.slice(0, 50)}${firstUserMessage.length > 50 ? "..." : ""}`
    : "Customer Support Request";

  return {
    subject,
    email,
    departmentId: env.ZOHO_DEPARTMENT_ID,
    contactId: env.ZOHO_CONTACT_ID,
    description: `<h3>Chat Conversation History</h3><div>${recentMessages}</div>`,
    priority: "Medium",
    status: "Open",
    channel: "Chat",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
