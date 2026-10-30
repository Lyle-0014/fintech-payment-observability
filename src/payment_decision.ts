import { z } from "zod";

export const paymentEventSchema = z.object({
  event_id: z.string().min(8),
  payment_id: z.string().min(1),
  account_id: z.string().min(1),
  amount_minor: z.number().int().positive(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  status: z.enum(["authorized", "captured", "declined"]),
  occurred_at: z.iso.datetime(),
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export type PaymentDecision = {
  action: "record" | "review";
  notification: {
    kind: "receipt" | "review_notice" | "decline_notice";
    subject: string;
  };
};

export function decidePaymentAction(
  event: PaymentEvent,
  reviewLargePayments: boolean,
): PaymentDecision {
  if (event.status === "declined") {
    return {
      action: "record",
      notification: { kind: "decline_notice", subject: "Payment could not be completed" },
    };
  }

  if (event.status === "captured" && reviewLargePayments && event.amount_minor >= 500_000) {
    return {
      action: "review",
      notification: { kind: "review_notice", subject: "Payment is being reviewed" },
    };
  }

  return {
    action: "record",
    notification: {
      kind: "receipt",
      subject: event.status === "captured" ? "Your payment receipt" : "Payment authorized",
    },
  };
}
