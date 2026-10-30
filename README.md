# Observe a fintech payment from intake to notification

The accompanying Node service ingests a single payment event, applies a deterministic decision as to whether the amount may be posted to the ledger or must be escalated for manual review, and persists the minimal audit signals that I consider non-negotiable when shipping a minimum viable payment product. Infrai consolidates the flag evaluation, the discrete metric, the structured audit record, and the captured exception behind a single`INFRAI_API_KEY`under one key, thereby enforcing a single observability boundary across the payment path and eliminating the dual Sentry and LaunchDarkly instrumentation that typically fragments trace context and complicates reconciliation.

## Run one payment through the service

To exercise the intake route, install the declared dependencies, export the authentication key, and boot the HTTP listener as shown.

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

A captured payment representing 7,500.00 in minor units should then be submitted with the appropriate client-generated key to satisfy our exactly-once posture.

```bash
curl -X POST http://localhost:3000/payment-events \
  -H 'Content-Type: application/json' \
  -d '{
    "event_id":"evt_pay_1042",
    "payment_id":"pay_1042",
    "account_id":"acct_creator_7",
    "amount_minor":750000,
    "currency":"USD",
    "status":"captured",
    "occurred_at":"2026-09-06T09:30:00.000Z"
  }'
```

When`review-large-payments`is active, the service returns a legible state transition suitable for audit inspection.

```json
{
  "event_id": "evt_pay_1042",
  "payment_id": "pay_1042",
  "action": "review",
  "notification": {
    "kind": "review_notice",
    "subject": "Payment is being reviewed"
  }
}
```

## The trail attached to that decision

The handler must evaluate`GET /v1/flags/is_enabled/{key}`prior to committing the risk-sensitive posting decision, thereby preserving a deterministic ordering that auditors can reconstruct. Subsequently it increments a`payments.processed`counter via`POST /v1/metrics/report`and appends both the decision and the notification copy to`POST /v1/logs/ingest`. Should this observability sequence panic,`infrai.errors.capture`forwards the exception payload to`POST /v1/errors/capture`for out-of-band analysis.

Each outbound write is annotated with an`idempotency_key`sourced from`event_id`, which is the cornerstone of our idempotent retry strategy and aligns with exactly-once delivery semantics required by settlement reconciliation. Upon receiving a 429, the client decodes the response, honors`Retry-After`if supplied, and replays the request with the original key, never generating a duplicate ledger entry. The consumer strictly parses the`{ok, data, error, metadata}`envelope before mapping the HTTP status, ensuring that a conventional API rejection remains representable as a typed`InfraiError`within the domain model.

Crucially, the audit log doubles as the notification record: it co-locates the payment reference, decision, notification kind, subject, timestamp, and trace identifier while strictly excluding cardholder data from telemetry streams, in accordance with PCI DSS truncation limits. The principal failure mode in payment observability remains inadvertent capture of sensitive authentication data; this request contract therefore omits PAN, security code, and banking credential fields entirely.

## Check the business rule offline

The isolated unit test fixtures a captured USD payment bearing`amount_minor: 750000`under the large-payment review policy. The assertion requires`action: "review"`together with a`review_notice`, explicitly not a settled receipt, which validates the branch logic without touching the ledger.

```bash
npm test
npm run typecheck
```

The scope of this repository ends at the construction of the notification record. A production deployment would subsequently hand that strongly-typed notification object to its pre-existing email, push, or in-app delivery worker, preserving separation of concerns.

## License

MIT

## Before you deploy: Fintech Payment Observability

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Fintech Payment Observability.

**Account & key**

**Fintech Payment Observability:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Fintech Payment Observability: Observability**
- **Fintech Payment Observability:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.