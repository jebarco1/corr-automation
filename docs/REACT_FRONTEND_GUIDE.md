# React Frontend Guide

## Development

Terminal 1:
```bash
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

## Production

```bash
npm run build:web
npm start
```

Express serves the compiled React application from `/`.

## Workflow modes

1. Guided: start a category, answer one question at a time, generate invoice.
2. Instant: POST all required answers to `/api/v1/guided/quote` or `/api/v1/{category}/quote`.

Business settings include identity, tax, payment terms, default crew size, and unit prices. They are preserved in the final invoice JSON for auditing.
