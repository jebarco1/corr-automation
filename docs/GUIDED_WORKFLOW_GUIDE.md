# Guided Start-to-Invoice API

Every service category has the same workflow contract:

1. `POST /api/v1/{category}/start`
2. Repeatedly send answers to `POST /api/v1/{category}/sessions/{sessionId}/answer`
3. Optionally run extra category APIs with `POST /api/v1/{category}/sessions/{sessionId}/run-api`
4. Create the invoice with `POST /api/v1/{category}/sessions/{sessionId}/invoice`

Supported categories:

`landscape`, `hvac`, `cleaning`, `pest-control`, `pool`, `painting`, `roofing`, `plumbing`, `electrical`, `general-contract`, `surveillance`, `trash-removal`, and `transportation`.

## Start

```bash
curl -X POST http://localhost:3000/api/v1/hvac/start \
  -H "Content-Type: application/json" \
  -d '{
    "taxRate": 8.9,
    "paymentTerms": "Net 15",
    "prefill": {
      "customer": {
        "name": "Taylor Smith",
        "email": "taylor@example.com"
      }
    }
  }'
```

The response includes `sessionId` and `nextQuestion`.

## Answer each question

```bash
curl -X POST http://localhost:3000/api/v1/hvac/sessions/SESSION_ID/answer \
  -H "Content-Type: application/json" \
  -d '{"value":"123 Main St, Atlanta, GA 30303"}'
```

Always render the returned `nextQuestion`. The question includes its key, expected type, whether it is required, options, and an example. Some answers automatically trigger a related trade API. Its output is added to `apiResults`.

## Run an additional API

```bash
curl -X POST http://localhost:3000/api/v1/hvac/sessions/SESSION_ID/run-api \
  -H "Content-Type: application/json" \
  -d '{
    "endpointType":"equipment-health-score",
    "payload":{"ageYears":12,"serviceHistoryCount":2}
  }'
```

## Generate the detailed invoice

```bash
curl -X POST http://localhost:3000/api/v1/hvac/sessions/SESSION_ID/invoice \
  -H "Content-Type: application/json" \
  -d '{
    "discount":25,
    "taxRate":8.9,
    "additionalLineItems":[
      {"description":"Permit fee","quantity":1,"unit":"fee","unitPrice":75,"amount":75}
    ]
  }'
```

The invoice response contains customer details, service address, line items, subtotal, discount, tax, total, notes, all question answers, and the API results that supported the estimate.

## Production notes

The current starter uses an in-memory session store. Replace it with PostgreSQL, DynamoDB, or Redis before deploying multiple instances. Add authentication and organization ownership checks so a tenant can only access its own sessions. Before sending an invoice, add a human approval step and connect the result to Stripe, QuickBooks, Xero, or the HA-Corr invoice service.
