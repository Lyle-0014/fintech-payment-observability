import express from "express";
import { pathToFileURL } from "node:url";
import { ZodError } from "zod";
import { infrai, InfraiError } from "./infrai_observability.js";
import { decidePaymentAction, paymentEventSchema } from "./payment_decision.js";

export const app = express();
app.use(express.json({ limit: "32kb" }));

app.post("/payment-events", async (request, response) => {
  try {
    const event = paymentEventSchema.parse(request.body);
    const reviewLargePayments = await infrai.flags.is_enabled("review-large-payments");
    const decision = decidePaymentAction(event, reviewLargePayments);
    const common = {
      service: "payment-intake",
      environment: process.env.NODE_ENV ?? "development",
      timestamp: new Date().toISOString(),
      trace_id: event.event_id,
    };

    await Promise.all([
      infrai.metrics.report({
        name: "payments.processed",
        value: 1,
        type: "counter",
        tags: { status: event.status, action: decision.action, currency: event.currency },
        idempotency_key: `metric:${event.event_id}`,
      }),
      infrai.logs.ingest({
        entries: [{
          ...common,
          level: decision.action === "review" ? "warn" : "info",
          message: "payment notification prepared",
          metadata: {
            payment_id: event.payment_id,
            account_id: event.account_id,
            amount_minor: event.amount_minor,
            currency: event.currency,
            payment_status: event.status,
            action: decision.action,
            notification_kind: decision.notification.kind,
            notification_subject: decision.notification.subject,
            occurred_at: event.occurred_at,
          },
        }],
        idempotency_key: `audit:${event.event_id}`,
      }),
    ]);

    response.status(decision.action === "review" ? 202 : 200).json({
      event_id: event.event_id,
      payment_id: event.payment_id,
      ...decision,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({ error: "invalid payment event", issues: error.issues });
      return;
    }

    const eventId = typeof request.body?.event_id === "string" ? request.body.event_id : "unidentified";
    try {
      await infrai.errors.capture({
        exception: error instanceof Error ? error.stack ?? error.message : String(error),
        message: "payment observability workflow failed",
        level: "error",
        fingerprint: ["payment-intake", "observability"],
        context: { event_id: eventId },
        idempotency_key: `error:${eventId}`,
      });
    } catch (captureError) {
      console.error("Could not record payment workflow error", captureError);
    }

    const status = error instanceof InfraiError && error.status >= 400 && error.status < 500
      ? error.status
      : 502;
    response.status(status).json({ error: error instanceof Error ? error.message : "payment workflow failed" });
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => console.log(`Payment intake listening on http://localhost:${port}`));
}
