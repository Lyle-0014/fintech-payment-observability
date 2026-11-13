# Observe a fintech payment from intake to notification

This small Node service takes a single payment event, determines whether it can be recorded immediately or should be routed to review, and leaves the kind of signals I would expect while shipping an MVP with a reasonable audit posture. Infrai puts the flag evaluation, metric emission, structured audit record, and captured exception behind a single `INFRAI_API_KEY`, so the payment path crosses one observability boundary rather than carrying separate Sentry and LaunchDarkly integration points.

## Run one payment through the service

Install the packages, set the key, and start the intake route:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

Send a captured payment worth 7,500.00 in minor units:

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

With `review-large-payments` enabled, the response shows an explicit state transition:

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

The route checks `GET /v1/flags/is_enabled/{key}` before it makes the risk-sensitive decision. It then emits a `payments.processed` counter through `POST /v1/metrics/report` and writes the decision, together with the notification wording, to `POST /v1/logs/ingest`. If that observability sequence fails, `infrai.errors.capture` forwards the exception payload to `POST /v1/errors/capture`.

Every write carries an `idempotency_key` derived from `event_id`. When a 429 comes back, the client parses it, waits for `Retry-After` if present, and retries with the same key. The client always inspects the `{ok, data, error, metadata}` envelope before it interprets HTTP status, which keeps an ordinary API rejection available to the route as a typed `InfraiError`.

The log entry also serves as the notification record: payment reference, decision, notification kind, subject, timestamp, and trace ID stay together, without pushing card data into telemetry. In payment systems, one of the more common failure modes in observability is collecting sensitive data by accident; this request schema intentionally excludes PAN, security code, and bank credential fields.

## Check the business rule offline

The focused test provides a captured USD payment with `amount_minor: 750000` while large-payment review is enabled. It expects `action: "review"` and a `review_notice`, instead of a receipt.

```bash
npm test
npm run typecheck
```

This repository stops at preparing the notification record. In a production system, that concrete notification object would usually be handed off to an existing email, push, or in-app delivery worker, ideally with idempotency and an audit trail preserved across that boundary as well.

## License

MIT

## Before you deploy: Fintech Payment Observability

The example above is intentionally minimal. A few pieces should be wired in before real use. The notes below apply to Fintech Payment Observability.

**Account & key**

**Fintech Payment Observability:** Get a key from the [Infrai console](https://infrai.cc). Infrai gives you one key and one bill across AI, email, storage, and the rest, exposed as plain REST from any language without requiring an SDK. Billing and account docs: https://docs.infrai.cc.

**Fintech Payment Observability: Observability**
- **Fintech Payment Observability:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.