# React Frontend Guide

## Development

Terminal 1:
```bash
cp .env.example .env
# set OPENAI_API_KEY in .env
npm install
npm run dev:api
```

Terminal 2:
```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173`.

## Home page behavior

- Categories, API chips, starter prompts, and question previews are local (no API call on load).
- Select a category, pick/edit a prompt, then start the guided quote.
- OpenAI runs only from the server `OPENAI_API_KEY` environment variable.
- The UI does not ask for an OpenAI key or client API key.

## Production

```bash
npm run build:web
npm start
```

Express serves the compiled React application from `/`.

## Workflow modes

1. Guided UI: select category locally → answer questions → generate invoice via `/api/v1/ai/*`.
2. Instant API: POST all required answers to `/api/v1/guided/quote` or `/api/v1/{category}/quote`.

Business settings include identity, tax, payment terms, default crew size, and unit prices. They are preserved in the final invoice JSON for auditing.
