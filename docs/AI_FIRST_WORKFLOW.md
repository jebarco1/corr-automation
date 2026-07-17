# AI-First Workflow and Client API Keys

## Secret separation

- `CORR_CLIENT_API_KEYS`: keys issued to the React application or outside integrations. Send one as `X-API-Key`.
- `OPENAI_API_KEY`: private server credential used only by the AI orchestrator. Never expose it through React or commit it.

Generate a client key with `npm run key:generate`. Add one or multiple comma-separated keys to `.env`.

## Start with AI

`POST /api/v1/ai/start` accepts a natural-language job description, an optional category override, business pricing, taxes, and prefilled answers. AI classifies the request, starts the matching guided workflow, recommends approved API tools, and returns the first question.

## Continue

`POST /api/v1/ai/chat` supports:

- `action: answer`: save the current answer and trigger any API tied to that question.
- `action: run-api`: execute an approved category API and attach its result to the session.
- `action: invoice`: create the deterministic draft invoice from all answers, API results, pricing, taxes, discounts, and additional line items.

When `OPENAI_API_KEY` is absent, development mode uses local keyword classification. Pricing and invoice math are always performed by application code rather than the language model.
