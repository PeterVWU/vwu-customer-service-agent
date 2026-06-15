# VWU Customer Service Agent

Cloudflare Workers + Agents SDK rebuild of the customer service chatbot.

## Architecture

- `CustomerSupportAgent` is a Cloudflare Agent backed by Durable Objects SQLite storage.
- Workers AI handles response generation. The default model is `@cf/google/gemma-4-26b-a4b-it`.
- Vectorize powers FAQ retrieval.
- Magento powers order lookup.
- Zoho Desk powers ticket creation through the existing `ZOHO_OAUTH_WORKER` service binding.

## Local Setup

```bash
npm install
npm run build
npm run start
```

Required secrets:

```bash
wrangler secret put MAGENTO_API_TOKEN
```

If local development needs real Vectorize/AI resources, run Wrangler with remote bindings or deploy to a staging Worker.

## Deploy

```bash
npm run deploy
```
