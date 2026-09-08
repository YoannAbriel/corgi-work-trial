// What to answer Stripe when a delivery could not take the processing lease.
//
// Pure decision, kept out of the route so it can be read and tested on its own. The lease
// itself is one SQL UPDATE in app/api/webhooks/stripe/route.ts; this says what the HTTP answer
// means once the lease was refused.

// The statuses of webhook_processing, the mutable nonfinancial table of the inbox.
export type WebhookProcessingStatus = "pending" | "processing" | "done" | "failed" | "ignored";

export type WebhookReply = {
  httpStatus: number;
  retryWanted: boolean; // true when Stripe should deliver this event again
  reason: string;
};

// A refused lease means one of two very different things, and answering the same way to both
// loses money events (review finding F-B2-02):
//
//   - 'done' or 'ignored': the event was already handled. Answering 200 is correct and stops
//     the retries.
//   - 'processing': another delivery holds the lease right now, OR a function died before its
//     posting transaction committed. Answering 200 would tell Stripe the event is handled and
//     end the retries, while the money may never have been posted and nobody would ever know.
//     So the answer is 503: Stripe retries later, and by then the five-minute lease expiry lets
//     the retry take the event over. A duplicate that arrives while a healthy delivery is still
//     in flight simply gets retried and finds the event 'done', which is the harmless case.
//
// Anything else (a missing row, an unexpected status) is treated the same way as 'processing':
// fail closed and let Stripe retry, rather than claim work that may not have happened.
export function replyForRefusedLease(status: WebhookProcessingStatus | null): WebhookReply {
  if (status === "done" || status === "ignored") {
    return { httpStatus: 200, retryWanted: false, reason: `already ${status}` };
  }
  return {
    httpStatus: 503,
    retryWanted: true,
    reason:
      status === "processing"
        ? "another delivery is processing this event, or one died before it committed; Stripe should retry"
        : `unexpected inbox status ${status ?? "missing"}; Stripe should retry`,
  };
}
