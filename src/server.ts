import { getAgentByName, routeAgentRequest } from "agents";
import { CustomerSupportAgent } from "./agent/CustomerSupportAgent";
import {
  getAnalyticsSummary,
  listConversationTurns,
  listRecentConversations,
  updateQualityReview,
  type ReviewUpdate,
} from "./analytics/conversationAnalytics";
import type { Env } from "./types";

export { CustomerSupportAgent };

const MAX_ANALYTICS_LIMIT = 100;

function corsHeaders(env: Env, request: Request): HeadersInit {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env.ALLOWED_ORIGIN || origin || "*";

  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? allowedOrigin : allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function isAuthorized(request: Request, env: Env): boolean {
  const expected = env.VWU_AGENT_AUTH_SECRET;
  if (!expected) return false;
  const header = request.headers.get("Authorization") || "";
  return header === `Bearer ${expected}`;
}

function parseLimit(url: URL): number {
  const requested = Number(url.searchParams.get("limit") || 25);
  if (!Number.isFinite(requested)) return 25;
  return Math.max(1, Math.min(MAX_ANALYTICS_LIMIT, Math.floor(requested)));
}

async function analyticsResponse(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/internal/analytics")) return null;

  if (!isAuthorized(request, env)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (url.pathname === "/internal/analytics/summary" && request.method === "GET") {
    const hours = Number(url.searchParams.get("hours") || 24);
    const sinceMs = Math.max(1, Math.min(24 * 90, Number.isFinite(hours) ? hours : 24)) * 60 * 60 * 1000;
    return Response.json({ ok: true, ...(await getAnalyticsSummary(env, sinceMs)) });
  }

  if (url.pathname === "/internal/analytics/conversations" && request.method === "GET") {
    return Response.json({ ok: true, conversations: await listRecentConversations(env, parseLimit(url)) });
  }

  const turnsMatch = url.pathname.match(/^\/internal\/analytics\/conversations\/([^/]+)\/turns$/);
  if (turnsMatch && request.method === "GET") {
    return Response.json({ ok: true, turns: await listConversationTurns(env, turnsMatch[1]) });
  }

  if (url.pathname === "/internal/analytics/review" && request.method === "POST") {
    const review = (await request.json()) as ReviewUpdate;
    await updateQualityReview(env, review);
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env, request) });
    }

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "customer-service-agent",
        model: env.WORKERS_AI_CHAT_MODEL,
      });
    }

    const internalAnalyticsResponse = await analyticsResponse(request, env, url);
    if (internalAnalyticsResponse) return internalAnalyticsResponse;

    if (url.pathname === "/internal/agent-smoke") {
      const agent = await getAgentByName(
        env.CustomerSupportAgent as unknown as DurableObjectNamespace<CustomerSupportAgent>,
        "deployment-smoke",
      );
      return Response.json(await agent.healthCheck());
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
