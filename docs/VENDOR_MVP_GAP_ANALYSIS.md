# Vendor website MVP — gap analysis (post-build)

Assessment after implementing the suggested MVP build order.

## Verdict

**Much closer — partial → strong MVP for vendor autopilot on leads + quotes + jobs.**  
A vendor website can now onboard a tenant, hunt/import leads, run CRM, send/accept quotes, take payment (Stripe or mock), schedule a job, emit webhooks, and accept public bookings.

Still **not** a full field-service suite (no technician GPS, inventory, accounting sync, or multi-region marketplace).

---

## Build-order status

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Tenant + auth | **Done** | `POST /vendors`, `vcorr_` keys, `requireVendorApiKey`, scoped JSON store rows |
| 2 | DB persistence | **Done** | Pure JSON store at `data/db/ha-corr.json` — leads, quotes, payments, jobs, sessions, webhooks, notifications (no SQLite) |
| 3 | Lead CRM API | **Done** | list/create/patch, notes, assign, link → quote, import hunt files |
| 4 | Quote lifecycle | **Done** | draft → send → accept/reject (+ public token links) |
| 5 | Payments | **Done** | Stripe Checkout when `STRIPE_SECRET_KEY` set; mock checkout otherwise |
| 6 | Jobs MVP | **Done** | Auto-create on accept; list/patch schedule + assignee |
| 7 | Webhooks + email/SMS | **Done** | Outbound signed webhooks; email/SMS via SendGrid/Resend/Twilio or console log |
| 8 | Customer booking page | **Done** | `/book/{slug}` + `/book/quote/{token}` React pages + public APIs |

---

## What a vendor site can do now

1. Create tenant → receive `vcorr_` API key  
2. Import GA hunt leads into CRM (`POST /vendors/me/leads/import-hunt`)  
3. Assign, note, status-transition leads  
4. Create & send quote → customer opens public link  
5. Customer accepts → job scheduled  
6. Customer pays (Stripe or mock) → `payment.succeeded` event  
7. Customer books via `/book/demo-landscape`  
8. Vendor UI: **Vendor Ops** tab; simulation: **Autopilot** tab  

---

## Remaining gaps (next)

| Gap | Severity | Suggestion |
|---|---|---|
| Guided/AI quote sessions still mostly in-memory (legacy) | Medium | Persist guided/interview Maps into `sessions` table per vendor |
| File-based hunt + pricing standards still global (not tenant-scoped) | Medium | Namespace hunt output / pricing JSON by `vendor_id` |
| No RBAC (owner vs dispatcher vs tech) | Medium | Roles on vendor members |
| Stripe webhook signature not fully verified | Medium | Add Stripe SDK signature check in production |
| Email/SMS are adapters (often console) | Medium | Require provider keys in prod; templates |
| No calendar UI / conflicts / tech capacity | Medium | Availability slots API |
| No e-sign / PDF invoice | Low | PDF render + accept attestation |
| Automation trade routes still starter-stubs | Low/Med | Keep as calculators until real adapters |
| No multi-region markets beyond GA pilots | Low | Expand markets JSON |
| Demo key only shown on first create | Low | Vendor Ops “create key” flow (already API-backed) |

---

## Security notes

- Vendor routes require `X-API-Key: vcorr_...`  
- Public booking/quote routes are intentionally open (token/slug scoped)  
- Legacy `/ai` and `/guided` remain open for the demo chatbot — put a BFF in front for production vendor sites  
- SQLite file must not be committed (gitignored)

---

## Quick start

```bash
npm run vendor:seed          # prints demo vendor apiKey
npm run build:web && npm run dev

# Vendor Ops tab → paste key → Import hunt leads
# Public booking: http://localhost:3000/book/demo-landscape
```
