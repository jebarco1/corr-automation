# HA-Corr Automation API — Class 0.5 Coaxium

Multi-trade automation API (**Class 0.5 Coaxium**, path `/api/v1`).

## API versioning

Releases use **Class + codename** (current: **Class 0.5 Coaxium**). The HTTP path remains `/api/v1`.

```bash
GET /version
GET /api/v1/version
GET /api/v1/versions
```

Responses and every API reply include version headers:

- `X-API-Class`
- `X-API-Codename`
- `X-API-Version-Name`
- `X-API-Semver`
- `X-API-Path-Version`

Update `src/config/apiVersion.js` when cutting a new Class.

## Industry URL namespaces

- `/api/v1/landscape/...`
- `/api/v1/hvac/...`
- `/api/v1/cleaning/...`
- `/api/v1/pest-control/...`
- `/api/v1/pool/...`
- `/api/v1/painting/...`
- `/api/v1/roofing/...`
- `/api/v1/plumbing/...`
- `/api/v1/electrical/...`
- `/api/v1/general-contract/...`
- `/api/v1/surveillance/...`
- `/api/v1/trash-removal/...`
- `/api/v1/transportation/...`
- `/api/v1/healthcare/...` (Nursing & Doctors)

List every category with its description:

```bash
GET /api/v1/categories
GET /api/v1/categories/{category}
```

## Pricing standards + invoice intelligence

Editable area pricing JSON lives in `data/pricing-standards/{category}.json`.

```bash
# Read / update standards
GET  /api/v1/pricing-standards
GET  /api/v1/{category}/pricing-standards
PUT  /api/v1/{category}/pricing-standards

# Upload invoice logs, then ask for LLM (or local) improvement advice
POST /api/v1/{category}/invoices/log
GET  /api/v1/{category}/invoices/log
POST /api/v1/{category}/invoices/suggest

# Refresh standards from uploaded invoice logs
POST /api/v1/{category}/pricing-standards/refresh
POST /api/v1/pricing-standards/refresh

# Workflow: ask AI for industry-standard rates and update JSON
GET  /api/v1/workflows
POST /api/v1/{category}/workflows/industry-standards
POST /api/v1/workflows/industry-standards
```

The industry-standards workflow asks OpenAI for mid-market rates (or uses curated local fallbacks) and writes `data/pricing-standards/{category}.json`. The invoice refresh workflow blends realized invoice rates into each area’s unit prices and can optionally refine with OpenAI when `OPENAI_API_KEY` is set.

## Sales / client expansion

Pass client or invoice areas to measure density and get geography + product/service investment ideas:

```bash
POST /api/v1/sales/client-density
POST /api/v1/sales/expansion-opportunities
POST /api/v1/sales/product-expansion
POST /api/v1/sales/market-expansion   # combined workflow
```

Example body:

```json
{
  "category": "transportation",
  "clients": [
    { "area": "Atlanta, GA", "revenue": 12000, "services": ["local move"] },
    { "area": "Atlanta, GA", "revenue": 8000, "services": ["delivery"] },
    { "area": "Dallas, TX", "revenue": 3500, "services": ["local move"] }
  ],
  "targetAreas": ["Austin, TX"]
}
```

You can also omit `clients` and set `"category"` after uploading invoice logs to derive areas from `data/invoice-logs`.

## Georgia lead hunting (B2B + residential)

Pilot markets live in `data/markets/georgia-cities.json`. Segment targets are in `data/lead-targets/{category}.json`. Hunted leads write under `data/leads/b2b/` and `data/leads/residential/`.

```bash
GET  /api/v1/leads/b2b
GET  /api/v1/leads/residential
GET  /api/v1/leads/origami/status
POST /api/v1/leads/b2b/hunt
POST /api/v1/leads/residential/hunt
```

Hunt body supports `provider: "origami" | "local" | "auto"` (default `auto`). When `ORIGAMI_API_KEY` is set, hunts use the [Origami Chat agent API](https://docs.origami.chat/agents/quickstart) to build contact tables (phone, email, address), then fall back to the local DuckDuckGo headhunter if a city returns empty or errors.

```bash
# CLI
npm run leads:hunt:b2b
LEAD_PROVIDER=origami npm run leads:hunt:residential
```

## Run

`.env` is **not** in git (secrets stay local). After every clone/pull, create it from the example:

```bash
cp .env.example .env
# set OPENAI_API_KEY in .env for the home AI chatbot and quoting
npm install
npm run dev
```

Open the home page at `http://localhost:3000/` — type a problem in the AI chatbot (calls `/api/v1/ai/assistant`). Category prompts are local; OpenAI uses `OPENAI_API_KEY` from your local `.env` only.

Open Swagger at `http://localhost:3000/docs`. Raw OpenAPI: `http://localhost:3000/openapi.yaml`.

## Important implementation note

Regrid-backed parcel endpoints can run when `REGRID_API_TOKEN` is configured. Other endpoints currently provide stable contracts and starter calculations. Connect weather, routing, imagery, computer vision, manufacturer, distributor, permit, disposal, accounting, and IoT adapters as required. Estimates, chemical guidance, diagnostics, safety findings, surveillance policies, healthcare/clinical guidance, credentialing checks, coding suggestions, and code-compliance outputs require qualified professional review before use.

## Guided Start-to-Invoice workflows

Version 5 adds a category-specific start API for all trades. Each session asks the next required question, invokes relevant automation APIs, preserves the results, and creates a detailed invoice JSON.

```text
POST /api/v1/{category}/start
POST /api/v1/{category}/sessions/{sessionId}/answer
POST /api/v1/{category}/sessions/{sessionId}/run-api
POST /api/v1/{category}/sessions/{sessionId}/invoice
```

See `docs/GUIDED_WORKFLOW_GUIDE.md` and Swagger at `/docs`.

## AI-first authenticated workflow

Generate a client key:

```bash
npm run key:generate
```

Place it in `.env` as `CORR_CLIENT_API_KEYS`. Multiple keys may be comma-separated. React and external callers send the selected key in `X-API-Key`. Store the OpenAI secret only in the server `.env` as `OPENAI_API_KEY`.

Homepage AI chatbot (type a problem → get a reply):

```bash
curl -X POST http://localhost:3000/api/v1/ai/assistant \
  -H "Content-Type: application/json" \
  -d '{"message":"My upstairs AC runs but does not cool"}'
```

Start a guided quote workflow through AI:

```bash
curl -X POST http://localhost:3000/api/v1/ai/start \
  -H "Content-Type: application/json" \
  -d '{"message":"The upstairs HVAC runs but does not cool","start":{"taxRate":8.9}}'
```

Continue the guided workflow with `POST /api/v1/ai/chat`. The assistant chatbot uses OpenAI when `OPENAI_API_KEY` is set and falls back to local category/pricing guidance otherwise.
