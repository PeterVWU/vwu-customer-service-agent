import { getAgentByName, routeAgentRequest } from "agents";
import { CustomerSupportAgent } from "./agent/CustomerSupportAgent";
import type { Env } from "./types";

export { CustomerSupportAgent };

function corsHeaders(env: Env, request: Request): HeadersInit {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env.ALLOWED_ORIGIN || origin || "*";

  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? allowedOrigin : allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
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
