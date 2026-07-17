# HA-Corr Automation API v4

Multi-trade automation API with **219 documented operations**.

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

## Run

```bash
cp .env.example .env
npm install
npm run dev
```

Open Swagger at `http://localhost:3000/docs`. Raw OpenAPI: `http://localhost:3000/openapi.yaml`.

## Important implementation note

Regrid-backed parcel endpoints can run when `REGRID_API_TOKEN` is configured. Other endpoints currently provide stable contracts and starter calculations. Connect weather, routing, imagery, computer vision, manufacturer, distributor, permit, disposal, accounting, and IoT adapters as required. Estimates, chemical guidance, diagnostics, safety findings, surveillance policies, and code-compliance outputs require qualified professional review before use.

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

Start a workflow through AI:

```bash
curl -X POST http://localhost:3000/api/v1/ai/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: corr_your_generated_key" \
  -d '{"message":"The upstairs HVAC runs but does not cool","start":{"taxRate":8.9}}'
```

Continue the conversation with `POST /api/v1/ai/chat`. The AI selects a category, recommends the appropriate internal APIs, starts the guided workflow, and returns the next question. Invoice creation remains deterministic and requires the `invoice` action.
