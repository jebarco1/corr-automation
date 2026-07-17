# API Usage Guide

1. Start the server and open `/docs`.
2. Select an industry tag.
3. Open an operation and click **Try it out**.
4. Replace the example fields with customer/job information.
5. Execute and save `requestId`, `input`, `data`, and `meta` in your application audit trail.
6. Treat `starter-calculation` results as preliminary. Check `meta.requiresProvider`, warnings, and compliance status.
7. Before production, add authentication, tenant isolation, rate limiting, provider adapters, persistent storage, idempotency keys, and role-based authorization.

Each endpoint accepts a JSON object. Swagger contains an example request and response for every operation.
