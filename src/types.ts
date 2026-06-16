export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  VECTORIZE: Vectorize;
  CustomerSupportAgent: DurableObjectNamespace;
  MAGENTO_API_URL: string;
  MAGENTO_API_TOKEN: string;
  ZOHO_DESK_URL: string;
  ZOHO_ORG_ID: string;
  ZOHO_DEPARTMENT_ID: string;
  ZOHO_CONTACT_ID: string;
  ZOHO_OAUTH_WORKER: {
    getAccessToken(): Promise<string>;
  };
  WORKERS_AI_CHAT_MODEL: string;
  WORKERS_AI_FAST_MODEL: string;
  WORKERS_AI_ESCALATION_MODEL: string;
  WORKERS_AI_EMBEDDING_MODEL: string;
  ALLOWED_ORIGIN: string;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: Exclude<ChatRole, "system">;
  content: string;
  createdAt: number;
}

export type PendingAction = "collect_order_number" | "clarify_faq" | "collect_email" | null;

export interface SupportState {
  messages: ChatMessage[];
  pendingAction: PendingAction;
  customerEmail?: string;
  orderNumber?: string;
  zohoTicketId?: string;
  lastIntent?: SupportIntent;
  updatedAt: number;
}

export type SupportIntent = "faq" | "order_status" | "ticket" | "other";

export interface ClientMessage {
  type: "chat" | "reset";
  content?: string;
}

export type ServerMessage =
  | { type: "state"; messages: ChatMessage[]; pendingAction: PendingAction }
  | { type: "typing"; value: boolean }
  | { type: "message"; message: ChatMessage; pendingAction: PendingAction }
  | { type: "error"; message: string };

export interface OrderDetails {
  orderNumber: string;
  status: string;
  trackingNumbers: string[];
  error?: string;
}

export interface FaqResult {
  answer: string;
  score: number;
  question?: string;
}

export interface TicketResult {
  ticketId?: string;
  message: string;
}
