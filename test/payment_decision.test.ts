import assert from "node:assert/strict";
import test from "node:test";
import { decidePaymentAction, paymentEventSchema } from "../src/payment_decision.js";

test("holds a large captured payment and prepares an audit-friendly review notice", () => {
  const event = paymentEventSchema.parse({
    event_id: "evt_pay_1042",
    payment_id: "pay_1042",
    account_id: "acct_creator_7",
    amount_minor: 750_000,
    currency: "usd",
    status: "captured",
    occurred_at: "2026-09-06T09:30:00.000Z",
  });

  assert.deepEqual(decidePaymentAction(event, true), {
    action: "review",
    notification: {
      kind: "review_notice",
      subject: "Payment is being reviewed",
    },
  });
});
