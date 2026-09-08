import { createHash } from "node:crypto";

// What an approver actually approves, and how it is bound so that nothing else can be executed
// in its place.
//
// The problem this solves: a maker asks for "$1,200 to the claimant's bank account ...6789", a
// checker approves it, and between the two something changes: the destination account, the
// amount, the claim. Executing the approval afterwards would move money nobody agreed to move.
//
// The fix, general non-negotiable 6 ("bind approval to the immutable intent, amount, beneficiary
// and version"): the four facts that make the intent are written into ONE canonical string, that
// string is hashed with SHA-256, and the hash is stored on the approval request. At execution
// the intent is rebuilt FROM THE CURRENT STATE OF THE WORLD and hashed again. Same hash, the
// world still matches what was approved. Different hash, the execution is refused and the maker
// must ask again.
//
// The canonical string is deliberately dull: four fields, in a fixed order, separated by a
// newline, no JSON, no key ordering to argue about, printable in full on the approval screen.

export type MoneyOutIntent = {
  kind: "claim_payment" | "refund";
  // What the money-out hangs off: a claim for a claim payment, a policy for a cancellation
  // refund. The subject is what an operator recognises; the amount and destination are what
  // makes this particular money-out different from another one on the same subject.
  subjectKind: "claim" | "policy";
  subjectId: string;
  amountCents: number;
  // Where the money goes, as an opaque but stable string: the simulated bank account token for
  // a claim payment, the Stripe PaymentIntent being given back for a refund. Never a bank
  // account number (see db/migrations/0008, claimant_bank_accounts).
  destination: string;
};

// The exact bytes that get hashed. Exported so the approval screen can show them: an approver
// who can read what was hashed can check that the hash on screen belongs to what they are
// approving, without trusting the application.
export function canonicalIntentText(intent: MoneyOutIntent): string {
  if (!Number.isSafeInteger(intent.amountCents) || intent.amountCents <= 0) {
    throw new Error(`an approved amount must be a positive whole number of cents, got ${intent.amountCents}`);
  }
  if (!intent.subjectId || !intent.destination) {
    throw new Error("an intent needs both a subject and a destination: an approval to nowhere cannot be checked");
  }
  // A newline cannot appear in any of these fields (they are ids, an integer and a token), so
  // no field can be crafted to look like the next one.
  return [
    `kind=${intent.kind}`,
    `subject=${intent.subjectKind}:${intent.subjectId}`,
    `amount_cents=${intent.amountCents}`,
    `destination=${intent.destination}`,
  ].join("\n");
}

// SHA-256 of the canonical text, lowercase hex. 64 characters, which is what the database
// CHECK on approval_requests.intent_hash enforces.
export function intentHash(intent: MoneyOutIntent): string {
  return createHash("sha256").update(canonicalIntentText(intent), "utf8").digest("hex");
}

// The destination strings, built in one place so the hash and the screens cannot disagree.
export function bankAccountDestination(accountToken: string): string {
  return `simulated_bank_account:${accountToken}`;
}

export function stripePaymentDestination(paymentIntentId: string): string {
  return `stripe_payment_intent:${paymentIntentId}`;
}
