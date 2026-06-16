# Old Agent Conversation Analysis

Source: Cloudflare KV namespace `14ca0ab595704208a505ea2dfe0c91ac` (`vwu-agent-chat-bot`), the old Worker's `CONVERSATIONS` binding.

Analysis date: 2026-06-16.

Data window inferred from conversation ids:

- Earliest conversation: 2026-05-17 21:46:24 UTC
- Latest conversation: 2026-06-16 19:37:51 UTC
- Parsed conversations: 1,101
- Malformed conversations: 0
- Total messages: 7,974
- Customer messages: 3,455
- Assistant messages: 4,519

Raw customer content was not committed to the repo. Examples below are redacted for emails, order numbers, long numeric ids, and phone-like values.

## Executive Summary

Customers mostly use the chatbot as an order-status and shipment-support tool. About two thirds of all conversations were primarily about order status, tracking, processing delays, delivery, or shipment problems.

The second major learning is that many customers are not asking static FAQ questions. They are trying to resolve open service issues: delayed processing, missing/wrong items, returned packages, store credit, duplicate charges, account access, verification, and reward-point usage. The bot often turns these into ticket flows, which is useful, but it also creates friction when it cannot explain the issue or set expectations.

The highest-value product work is to make order lookup, shipping expectations, returns/missing-item handling, store credit/rewards guidance, and escalation status much stronger before broadening into less common FAQ areas.

## Volume And Conversation Shape

- Conversations: 1,101
- Average customer turns per conversation: 3.14
- Median customer turns: 2
- One-turn conversations: 301, about 27.3%
- Conversations with 4+ customer turns: 345, about 31.3%
- Maximum customer turns in one conversation: 25

Signals from the full history:

- Conversations containing an order number: 358, about 32.5%
- Conversations containing an email address: 399, about 36.2%
- Conversations where the customer asked for support, a ticket, a person, contact, email, or phone: 187, about 17.0%
- Conversations with 3+ customer turns after bot responses: 530, about 48.1%

## What People Asked

Primary topic classification, one primary label per conversation:

| Topic | Conversations | Share |
| --- | ---: | ---: |
| Order status, tracking, delivery, processing | 728 | 66.1% |
| Other or unclear short asks | 157 | 14.3% |
| Product availability or product details | 60 | 5.4% |
| Human support or contact | 39 | 3.5% |
| Returns, refunds, cancellations, wrong/missing items | 37 | 3.4% |
| Pricing, discounts, coupons, minimums, store credit | 37 | 3.4% |
| Payment, checkout, website errors | 20 | 1.8% |
| Account, login, wholesale account, verification | 18 | 1.6% |
| Greeting or empty | 2 | 0.2% |
| Shipping policy and shipping costs | 2 | 0.2% |
| Compliance and restrictions | 1 | 0.1% |

Multi-label classification shows overlap between issues:

| Topic Signal | Conversations |
| --- | ---: |
| Order status, tracking, delivery, processing | 728 |
| Human support or contact | 197 |
| Product availability or product details | 141 |
| Returns, refunds, cancellations, wrong/missing items | 135 |
| Payment, checkout, website errors | 86 |
| Pricing, discounts, coupons, minimums, store credit | 63 |
| Shipping policy and shipping costs | 52 |
| Account, login, wholesale account, verification | 43 |
| Compliance and restrictions | 6 |

The primary-topic table undercounts issues that happen inside order conversations. For example, missing items, refunds, payment disputes, and human-support requests often start as order-status conversations.

## Main Customer Needs

### 1. Order Status And Processing Delays

This is the dominant use case. Customers ask whether an order shipped, why an order is still processing, why tracking has not updated, when the order will be brought to the carrier, and whether the package was delivered.

Representative redacted examples:

- "i placed an order days ago why is it not shipped"
- "Has my order shipped yet"
- "Track my order"
- "Why is my order status is processing yet?"
- "I was seeing if there's anything wrong with my order. It's usually ships by now"
- "if i placed my order on monday night when should i expect to receive tracking"

Learning: the agent should not only return the raw Magento order status. It should explain what the status means, what is normal for the current processing age, whether tracking exists, and when the customer should escalate.

### 2. Post-Order Problems

Many customers report operational problems after delivery or shipment: wrong item, missing item, returned to sender, delivered to the wrong place, return label not received, cancellation requests, refunds, and store-credit follow-up.

Representative redacted examples:

- "I order the wrong item. May I exchange them"
- "Why was my order returned to sender"
- "My order is not correct. I was supposed to receive 2 packs and received singles instead"
- "Hi I placed an order and received someone else's order"
- "cancel my order"
- "I haven't recieved an email on how to use my store credit"

Learning: these are not simple FAQ intents. They need a structured issue-intake flow that captures order number, email, problem type, affected item, photo/return-label need if applicable, and preferred resolution.

### 3. Rewards, Discounts, Coupons, And Store Credit

Customers repeatedly ask how to apply reward points, why discount codes are not working, how to use signup coupons, and how to apply store credit.

Representative redacted examples:

- "How to apply reward points"
- "How to use rewards"
- "Why are no discount codes working"
- "I need a discount code to enter to my new order. For store credit"
- "How do I get my $50.00 coupon"

Learning: this needs a high-confidence FAQ/tool answer. It is common enough to deserve explicit coverage and probably a website UX check, because customers appear confused at checkout.

### 4. Product Questions And Availability

Customers ask whether a specific kit includes a battery, whether packs contain a certain quantity, whether products or flavors will be restocked, and whether they can suggest products.

Representative redacted examples:

- "does one pack of zyn contain 5 tins"
- "Do you know when the pacha mama Fuji 30 ml juice will be back in stock"
- "I want to suggest a product to stock"
- "Is there a way I can get the nicotine pouches all 12 mg"
- "Foger Switch Pro 30,000 Puffs Disposable Kit ... does it include a battery"

Learning: the current FAQ/vector set should be expanded with product-packaging clarifications and restock/product-request handling. If product catalog data is available, the agent should retrieve live product attributes rather than guess.

### 5. Account, Verification, And Wholesale Access

This is smaller than order support but important because it can block purchases. Customers ask about wholesale account access, password resets, ID upload, order verification, and business-license requirements.

Representative redacted examples:

- "I cannot access my wholesale account"
- "Im trying to log into my account and unable to"
- "Forgot my password"
- "Upload id for verification"
- "Why does my order say verification required?"
- "Do i need to show proof of my age"

Learning: account and verification issues should have a clear escalation path and canned guidance. The agent should avoid pretending it can reset accounts unless a real account-management tool exists.

### 6. Payment, Checkout, And Website Errors

Customers ask whether payments went through, why transactions were declined, why cards were charged, why shipping address changes fail, and why checkout applied fees or coupons incorrectly.

Representative redacted examples:

- "Did my payment go through for [order_number]"
- "It says declined but charged my card two times?!"
- "I like to know why my transaction was declined"
- "Why cant I change my shipping address from ny billing"
- "I press that I want to add an item and it's double charge..."

Learning: payment issues require careful language and escalation. The agent should not make payment-status claims unless backed by a payment/order API.

## Bot Behavior Signals

From assistant messages:

- Empty assistant responses: 186
- Ticket-created mentions: 359
- Ticket/email prompt mentions: 467
- Order-number prompts: 313
- Apology/failure/uncertainty mentions: 376

Interpretation:

- The old bot escalated heavily. Roughly one third of conversations include a ticket-created signal.
- Empty assistant responses are a clear quality problem.
- Many conversations ask for an order number, then still require a ticket because the raw status does not answer the customer's real concern.
- The bot should explain ticket purpose and expected follow-up, because customers explicitly ask what the ticket does.

## Recommended Changes For The New Agent

1. Make order status the flagship path.
   - Retrieve order status, shipment status, tracking number, carrier, and relevant timestamps.
   - Explain "processing", "shipped", "delivered", "returned", and "verification required" in customer language.
   - Add escalation thresholds, for example: processing longer than expected, tracking stuck, delivered but not received, returned to sender.

2. Add structured issue intake for post-order problems.
   - Supported issue types should include missing item, wrong item, damaged item, returned package, refund request, cancellation, store credit, and return label follow-up.
   - Collect the minimum data needed before ticket creation.
   - Include the conversation summary and issue type in the Zoho ticket payload.

3. Expand FAQ coverage around repeated confusion.
   - Reward points and store credit usage.
   - Discount/coupon rules.
   - Processing time and tracking timing.
   - Shipping states, adult signature, discreet shipping, and age verification.
   - Zyn pack/tin quantity and common product-packaging questions.
   - Restock timing and product-request handling.

4. Add a product lookup path if catalog access is available.
   - Customers ask product-specific questions that static FAQ may not answer.
   - Live catalog attributes would reduce hallucination risk for pack size, battery inclusion, stock status, and variants.

5. Improve escalation clarity.
   - When creating a ticket, tell the customer what happens next and avoid duplicate ticket creation in the same conversation.
   - If the user asks for a person, collect email and issue details directly instead of looping through generic FAQ answers.

6. Instrument the new agent.
   - Store topic, outcome, tool calls, ticket id, failure reason, and whether the customer got a direct answer.
   - This will make future analysis more reliable than keyword classification over raw chat text.

## Caveats

Topic classification used deterministic keyword rules over all user messages in each conversation. It is good enough to identify major demand patterns, but individual labels can be noisy. The biggest source of noise is that many conversations combine order status with refunds, missing items, tickets, payment, or product questions.

The source KV entries have a 30-day retention policy in the old Worker, so this analysis reflects retained history from 2026-05-17 through 2026-06-16, not all-time history.
