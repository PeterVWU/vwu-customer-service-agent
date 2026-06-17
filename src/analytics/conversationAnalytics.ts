import type { ChatMessage, Env, PendingAction, SupportIntent, SupportOutcome } from "../types";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const ORDER_RE = /\b(?:order\s*#?\s*)?([0-9]{6,12})\b/gi;

export interface ConversationTurnAnalytics {
  sessionName: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  intent: SupportIntent;
  outcome: SupportOutcome;
  pendingAction: PendingAction;
  issueType?: SupportIntent;
  issueSummary?: string;
  orderNumber?: string;
  customerEmail?: string;
  zohoTicketId?: string;
  latencyMs: number;
}

export interface ToolAnalytics {
  sessionName: string;
  name: string;
  input: unknown;
  output: unknown;
  createdAt: number;
}

export interface ReviewUpdate {
  entity: "conversation" | "turn";
  id: string;
  qualityStatus: "unreviewed" | "good" | "needs_review" | "bad";
  qualityScore?: number;
  qualityNotes?: string;
  reviewedBy?: string;
}

interface ConversationRow {
  id: string;
  session_hash: string;
  first_seen_at: number;
  last_seen_at: number;
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  last_intent: string | null;
  last_outcome: string | null;
  pending_action: string | null;
  zoho_ticket_id: string | null;
  quality_status: string;
  quality_score: number | null;
  quality_notes: string | null;
}

interface TurnRow {
  id: string;
  conversation_id: string;
  user_content_redacted: string;
  assistant_content_redacted: string | null;
  intent: string;
  outcome: string;
  pending_action: string | null;
  latency_ms: number;
  created_at: number;
  quality_status: string;
  quality_score: number | null;
  quality_notes: string | null;
}

export async function recordConversationTurn(env: Env, analytics: ConversationTurnAnalytics): Promise<void> {
  if (!env.ANALYTICS_DB) return;

  const now = Date.now();
  const conversationId = await conversationIdFor(analytics.sessionName);
  const sessionHash = await sha256Hex(analytics.sessionName);
  const emailHash = analytics.customerEmail ? await sha256Hex(analytics.customerEmail.toLowerCase()) : null;
  const orderHash = analytics.orderNumber ? await sha256Hex(analytics.orderNumber) : null;

  await env.ANALYTICS_DB.batch([
    env.ANALYTICS_DB.prepare(
      `INSERT INTO conversations (
        id, session_hash, agent_name, first_seen_at, last_seen_at, message_count,
        user_message_count, assistant_message_count, last_intent, last_outcome,
        pending_action, customer_email_hash, order_number_hash, zoho_ticket_id
      ) VALUES (?, ?, ?, ?, ?, 2, 1, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        message_count = conversations.message_count + 2,
        user_message_count = conversations.user_message_count + 1,
        assistant_message_count = conversations.assistant_message_count + 1,
        last_intent = excluded.last_intent,
        last_outcome = excluded.last_outcome,
        pending_action = excluded.pending_action,
        customer_email_hash = COALESCE(excluded.customer_email_hash, conversations.customer_email_hash),
        order_number_hash = COALESCE(excluded.order_number_hash, conversations.order_number_hash),
        zoho_ticket_id = COALESCE(excluded.zoho_ticket_id, conversations.zoho_ticket_id)`,
    ).bind(
      conversationId,
      sessionHash,
      "CustomerSupportAgent",
      now,
      now,
      analytics.intent,
      analytics.outcome,
      analytics.pendingAction,
      emailHash,
      orderHash,
      analytics.zohoTicketId ?? null,
    ),
    insertMessageStatement(env, conversationId, analytics.userMessage, analytics.intent, analytics.outcome, analytics.pendingAction),
    insertMessageStatement(
      env,
      conversationId,
      analytics.assistantMessage,
      analytics.intent,
      analytics.outcome,
      analytics.pendingAction,
    ),
    env.ANALYTICS_DB.prepare(
      `INSERT INTO conversation_turns (
        id, conversation_id, user_message_id, assistant_message_id,
        user_content, user_content_redacted, assistant_content, assistant_content_redacted,
        intent, outcome, pending_action, issue_type, issue_summary,
        order_number_hash, customer_email_hash, zoho_ticket_id, latency_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      conversationId,
      analytics.userMessage.id,
      analytics.assistantMessage.id,
      analytics.userMessage.content,
      redactSensitiveText(analytics.userMessage.content),
      analytics.assistantMessage.content,
      redactSensitiveText(analytics.assistantMessage.content),
      analytics.intent,
      analytics.outcome,
      analytics.pendingAction,
      analytics.issueType ?? null,
      analytics.issueSummary ? redactSensitiveText(analytics.issueSummary) : null,
      orderHash,
      emailHash,
      analytics.zohoTicketId ?? null,
      Math.round(analytics.latencyMs),
      analytics.assistantMessage.createdAt,
    ),
  ]);
}

export async function recordAnalyticsToolEvent(env: Env, analytics: ToolAnalytics): Promise<void> {
  if (!env.ANALYTICS_DB) return;

  const conversationId = await conversationIdFor(analytics.sessionName);
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO analytics_tool_events (id, conversation_id, name, input_json, output_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      conversationId,
      analytics.name,
      redactSensitiveJson(analytics.input),
      redactSensitiveJson(analytics.output),
      analytics.createdAt,
    )
    .run();
}

export async function getAnalyticsSummary(env: Env, sinceMs: number): Promise<Record<string, unknown>> {
  const since = Date.now() - sinceMs;
  const [conversationCount, turnCount, byIntent, byOutcome, reviewQueue] = await Promise.all([
    env.ANALYTICS_DB.prepare("SELECT COUNT(*) AS count FROM conversations WHERE last_seen_at >= ?").bind(since).first<{ count: number }>(),
    env.ANALYTICS_DB.prepare("SELECT COUNT(*) AS count FROM conversation_turns WHERE created_at >= ?").bind(since).first<{ count: number }>(),
    env.ANALYTICS_DB.prepare(
      `SELECT intent, COUNT(*) AS count
       FROM conversation_turns
       WHERE created_at >= ?
       GROUP BY intent
       ORDER BY count DESC`,
    )
      .bind(since)
      .all<{ intent: string; count: number }>(),
    env.ANALYTICS_DB.prepare(
      `SELECT outcome, COUNT(*) AS count
       FROM conversation_turns
       WHERE created_at >= ?
       GROUP BY outcome
       ORDER BY count DESC`,
    )
      .bind(since)
      .all<{ outcome: string; count: number }>(),
    env.ANALYTICS_DB.prepare(
      `SELECT COUNT(*) AS count
       FROM conversation_turns
       WHERE quality_status = 'unreviewed' AND created_at >= ?`,
    )
      .bind(since)
      .first<{ count: number }>(),
  ]);

  return {
    since,
    conversations: conversationCount?.count ?? 0,
    turns: turnCount?.count ?? 0,
    byIntent: byIntent.results,
    byOutcome: byOutcome.results,
    unreviewedTurns: reviewQueue?.count ?? 0,
  };
}

export async function listRecentConversations(env: Env, limit: number): Promise<ConversationRow[]> {
  const result = await env.ANALYTICS_DB.prepare(
    `SELECT id, session_hash, first_seen_at, last_seen_at, message_count,
      user_message_count, assistant_message_count, last_intent, last_outcome,
      pending_action, zoho_ticket_id, quality_status, quality_score, quality_notes
     FROM conversations
     ORDER BY last_seen_at DESC
     LIMIT ?`,
  )
    .bind(limit)
    .all<ConversationRow>();

  return result.results;
}

export async function listConversationTurns(env: Env, conversationId: string): Promise<TurnRow[]> {
  const result = await env.ANALYTICS_DB.prepare(
    `SELECT id, conversation_id, user_content_redacted, assistant_content_redacted,
      intent, outcome, pending_action, latency_ms, created_at,
      quality_status, quality_score, quality_notes
     FROM conversation_turns
     WHERE conversation_id = ?
     ORDER BY created_at ASC`,
  )
    .bind(conversationId)
    .all<TurnRow>();

  return result.results;
}

export async function updateQualityReview(env: Env, review: ReviewUpdate): Promise<void> {
  const table = review.entity === "conversation" ? "conversations" : "conversation_turns";
  await env.ANALYTICS_DB.prepare(
    `UPDATE ${table}
     SET quality_status = ?, quality_score = ?, quality_notes = ?, reviewed_at = ?, reviewed_by = ?
     WHERE id = ?`,
  )
    .bind(
      review.qualityStatus,
      review.qualityScore ?? null,
      review.qualityNotes ?? null,
      Date.now(),
      review.reviewedBy ?? null,
      review.id,
    )
    .run();
}

function insertMessageStatement(
  env: Env,
  conversationId: string,
  message: ChatMessage,
  intent: SupportIntent,
  outcome: SupportOutcome,
  pendingAction: PendingAction,
): D1PreparedStatement {
  return env.ANALYTICS_DB.prepare(
    `INSERT OR IGNORE INTO conversation_messages (
      id, conversation_id, role, content, content_redacted, intent, outcome, pending_action, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    message.id,
    conversationId,
    message.role,
    message.content,
    redactSensitiveText(message.content),
    intent,
    outcome,
    pendingAction,
    message.createdAt,
  );
}

async function conversationIdFor(sessionName: string): Promise<string> {
  return `conv_${await sha256Hex(sessionName)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function redactSensitiveJson(value: unknown): string {
  return redactSensitiveText(JSON.stringify(value));
}

function redactSensitiveText(value: string): string {
  return value
    .replace(EMAIL_RE, "[email]")
    .replace(ORDER_RE, (match) => (/\d{6,12}/.test(match) ? "[order]" : match));
}
