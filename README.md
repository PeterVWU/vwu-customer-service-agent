# VWU Customer Service Agent

Cloudflare Workers + Agents SDK rebuild of the Vape Wholesale USA customer service chatbot.

The live Worker is:

```text
https://vwu-customer-service-agent.info-ba2.workers.dev
```

## What It Does

- Answers customer FAQ questions using Workers AI embeddings + Vectorize.
- Checks Magento order status and tracking numbers.
- Creates Zoho Desk tickets when the customer needs human support.
- Handles unknown FAQ questions by asking for clarification first, then creating a ticket if the answer is still unclear.
- Keeps the legacy compact chat UI so the migration does not change the customer-facing experience.

## Architecture

- `src/server.ts` routes HTTP, assets, health checks, and Agent traffic.
- `src/agent/CustomerSupportAgent.ts` contains the main support workflow.
- `src/tools/faq.ts` queries Vectorize with Workers AI embeddings.
- `src/tools/magento.ts` calls Magento REST APIs for order lookup.
- `src/tools/zoho.ts` creates Zoho Desk tickets through the existing `ZOHO_OAUTH_WORKER` service binding.
- `src/client/*` contains the React chat UI.

State is stored in Cloudflare Durable Objects through the Agents SDK:

- Conversation history lives in each `CustomerSupportAgent` Durable Object state.
- Tool call logs are stored in that Durable Object's SQLite `tool_events` table.
- The old KV-based `CONVERSATIONS` store is not used by this new Worker.

## Models

Configured in `wrangler.jsonc`:

```json
{
  "WORKERS_AI_CHAT_MODEL": "@cf/google/gemma-4-26b-a4b-it",
  "WORKERS_AI_FAST_MODEL": "@cf/ibm-granite/granite-4.0-h-micro",
  "WORKERS_AI_ESCALATION_MODEL": "@cf/openai/gpt-oss-120b",
  "WORKERS_AI_EMBEDDING_MODEL": "@cf/baai/bge-base-en-v1.5"
}
```

Current code uses:

- `@cf/baai/bge-base-en-v1.5` for FAQ embeddings.
- `@cf/google/gemma-4-26b-a4b-it` to polish tool-backed replies.

The escalation model is configured but not currently used in the support flow.

## Cloudflare Resources

- Worker: `vwu-customer-service-agent`
- Durable Object class: `CustomerSupportAgent`
- Vectorize index: `faq-embedding-index`
- Service binding: `ZOHO_OAUTH_WORKER` -> `zoho-oath-worker`
- Assets: served from `dist`

Current Vectorize index size at launch:

- Vectors: `17`
- Dimensions: `768`
- Stored dimensions: `13,056`

## Required Secrets

Set these in Cloudflare before production use:

```bash
npx wrangler secret put MAGENTO_API_TOKEN
npx wrangler secret put MAGENTO_WORKER_SECRET
```

The `MAGENTO_WORKER_SECRET` must match the secret expected by the Magento-side Cloudflare WAF/custom rule. Do not commit secret values to the repo.

Zoho auth is provided through the existing `ZOHO_OAUTH_WORKER` service binding.

## Environment Variables

Defined in `wrangler.jsonc`:

- `ENVIRONMENT`
- `MAGENTO_API_URL`
- `ZOHO_DESK_URL`
- `ZOHO_ORG_ID`
- `ZOHO_DEPARTMENT_ID`
- `ZOHO_CONTACT_ID`
- `WORKERS_AI_CHAT_MODEL`
- `WORKERS_AI_FAST_MODEL`
- `WORKERS_AI_ESCALATION_MODEL`
- `WORKERS_AI_EMBEDDING_MODEL`
- `ALLOWED_ORIGIN`

Production `ALLOWED_ORIGIN` is currently:

```text
https://vapewholesaleusa.com
```

## Local Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run locally:

```bash
npm run start
```

Notes:

- Workers AI always uses remote resources.
- Vectorize local development is limited unless using remote bindings or deployed Workers.
- Local Wrangler may need Cloudflare auth already configured.

## Deploy

```bash
npm run deploy
```

Latest known deployed version after the legacy UI update:

```text
bd85f7b1-3934-48a7-9a02-620955ffa428
```

## Production Cutover

To make the new agent live:

1. Point the production chat/API route or custom domain to `vwu-customer-service-agent`.
2. Confirm `ALLOWED_ORIGIN` matches the production site.
3. Confirm Magento only allows Worker-originated API calls using the `MAGENTO_WORKER_SECRET` header.
4. Update the website embed/API endpoint from the old Worker to the new Worker.
5. Smoke test FAQ, order lookup, unknown-question clarification, and Zoho ticket creation.

Suggested smoke tests:

- Ask a normal FAQ question.
- Ask for an order status with a real order number.
- Ask an unclear support question, clarify once, then confirm a Zoho ticket is created.

## Cost Notes

Based on the old agent's retained KV conversations from May 17, 2026 to June 16, 2026:

- Old volume: about `1,099` conversations/month.
- Average customer turns: about `3.2` per conversation.
- Estimated Workers AI inference: usually below `$1/month` at that volume.
- Durable Object storage: expected to remain inside the included `5 GB-month` for a long time at current volume.
- Vectorize storage/query volume is currently far below included usage.

The new agent does not yet enforce automatic conversation retention cleanup. Add TTL or a scheduled cleanup before storing long-term production history indefinitely.

## Useful Commands

```bash
npm run build
npm run lint
npm run start
npm run deploy
```

Check the deployed Worker:

```bash
curl -sS https://vwu-customer-service-agent.info-ba2.workers.dev/health
```
