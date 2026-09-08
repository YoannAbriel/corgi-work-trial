import { assertStripeSandbox, stripe } from "@/lib/stripe";
import { ledgerCashMovements } from "./ledger-side";
import type { ReconciliationSource } from "./source";
import { stripeRecordsFromListing, type StripeWindowListing } from "./stripe-records";
import { unixSeconds, type ReconciliationWindow } from "./window";

// Stripe as a reconciliation source: the network part. Three paginated listings for the window,
// handed to the pure mapping in ./stripe-records.ts. Any error Stripe raises (network,
// authentication, rate limit) propagates to the run, which stores a FAILED run: a listing that
// could not be completed is never reported as "nothing to reconcile".

// Pages of 100, walked to the end by the SDK. The hard cap is a safety net far above anything a
// 31-day trial window can hold (lib/reconciliation/window.ts), not a business limit.
const MAX_OBJECTS_PER_LISTING = 10000;

// A refund Stripe has neither completed nor refused after this long is reported as stale.
// ASSUMPTION of this build, not a Stripe guarantee: card refunds are usually settled within
// minutes and Stripe documents 5 to 10 business days for the money to reach the cardholder, so a
// day without any answer at all means something needs a human. Flagged for Yoann in the notes.
export const STRIPE_STALE_AFTER_HOURS = 24;

export async function fetchStripeWindow(window: ReconciliationWindow): Promise<StripeWindowListing> {
  // AF-04: Stripe's own statement that it answers in test mode, before anything is read.
  await assertStripeSandbox();
  const created = { gte: unixSeconds(window.from), lte: unixSeconds(window.to) };
  const [paymentIntents, refunds, balanceTransactions] = await Promise.all([
    stripe.paymentIntents.list({ created, limit: 100 }).autoPagingToArray({ limit: MAX_OBJECTS_PER_LISTING }),
    stripe.refunds.list({ created, limit: 100 }).autoPagingToArray({ limit: MAX_OBJECTS_PER_LISTING }),
    stripe.balanceTransactions.list({ created, limit: 100 }).autoPagingToArray({ limit: MAX_OBJECTS_PER_LISTING }),
  ]);
  return { paymentIntents, refunds, balanceTransactions };
}

export const stripeSource: ReconciliationSource = {
  name: "stripe",
  staleAfterHours: STRIPE_STALE_AFTER_HOURS,
  fetch: async (window) => stripeRecordsFromListing(await fetchStripeWindow(window)),
  readLedger: (window, database) =>
    ledgerCashMovements({ cashAccount: "cash_stripe", operationProvider: "stripe", window }, database),
};
