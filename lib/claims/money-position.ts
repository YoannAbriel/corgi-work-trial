// Where a claim's money stands, folded from its events. Nothing here is stored: the reserve,
// what has been paid and what has been incurred are all recomputed from claim_events every time
// they are needed, so there is no second truth that can drift from the journal.
//
// Track 1 asks for exactly this ("reserve adjustments append-only, payments reduce reserve,
// incurred = paid + reserve, cannot pay past limit"), so the identity below is the point of the
// whole module:
//
//     incurred = paid + outstanding reserve
//
// and it is also the balance of the incurred_loss_expense account, which is what
// scripts/check-claims-and-approvals.ts checks after every step.
//
// -------------------------------------------------------------------------------------------
// WHY "paid" COUNTS A PAYMENT FROM THE MOMENT IT IS SENT, NOT WHEN IT SETTLES
// -------------------------------------------------------------------------------------------
// ARCHITECTURE.md section 2 books a payment out of the reserve when it is SENT (Dr claim_reserve
// / Cr claims_payable) and says elsewhere "paid = settled payments minus returns". Those two
// sentences cannot both hold: between sending and settling, the money has left the reserve, so
// counting only settled money would make incurred drop for a day or two and then come back.
//
// This build resolves it the way an insurer does: a payment counts as paid the moment it is
// issued, and a return puts it back. `settledCents` is reported separately, because "the rail
// says the money has actually gone" is a different and useful fact, shown next to it on the
// claim screen. Recorded as a deviation in docs/handoffs/b7-implementation-notes.md.

export type ClaimEventType =
  | "reserve_set"
  | "reserve_adjusted"
  | "payment_requested"
  | "payment_sent"
  | "payment_settled"
  | "payment_returned"
  | "closed";

// The two fields of a claim event that move money. See db/migrations/0008 for what
// amountCents means for each type; the short version is that a reserve event carries the NEW
// OUTSTANDING RESERVE and a payment event carries that payment's amount.
export type ClaimMoneyEvent = {
  eventType: ClaimEventType;
  amountCents: number | null;
};

export type ClaimMoneyPosition = {
  reserveCents: number; // still expected to be paid on this claim
  paidCents: number; // sent on the rail and not returned
  settledCents: number; // confirmed gone by the rail, and not returned
  incurredCents: number; // paid + reserve: what this claim has cost us so far
  isClosed: boolean;
  hasReserve: boolean; // false until a reserve has ever been set
};

export function claimMoneyPosition(events: ClaimMoneyEvent[]): ClaimMoneyPosition {
  let reserveCents = 0;
  let paidCents = 0;
  let settledCents = 0;
  let isClosed = false;
  let hasReserve = false;

  for (const event of events) {
    const amountCents = event.amountCents;
    switch (event.eventType) {
      case "reserve_set":
      case "reserve_adjusted":
        // The event carries the new outstanding reserve, so it is an assignment, not an addition.
        reserveCents = requireAmount(event, amountCents);
        hasReserve = true;
        break;
      case "payment_sent":
        // The payment leaves the reserve and becomes money paid out.
        reserveCents -= requireAmount(event, amountCents);
        paidCents += requireAmount(event, amountCents);
        break;
      case "payment_settled":
        settledCents += requireAmount(event, amountCents);
        break;
      case "payment_returned":
        // The exact opposite of sending, plus undoing the settlement that preceded it.
        reserveCents += requireAmount(event, amountCents);
        paidCents -= requireAmount(event, amountCents);
        settledCents -= requireAmount(event, amountCents);
        break;
      case "payment_requested":
        // Asking to pay moves no money. It only reserves capacity, which is a check done at
        // request time (lib/claims/limits.ts), never a ledger movement.
        break;
      case "closed":
        isClosed = true;
        break;
    }
  }

  if (reserveCents < 0) {
    // Unreachable through the application: a payment is refused when it exceeds the reserve,
    // and a return can only give back what was sent. If it ever happens, the claim screen must
    // stop rather than show a negative reserve as if it were normal.
    throw new Error(`claim events fold to a negative reserve (${reserveCents} cents), which is not a possible state`);
  }

  return {
    reserveCents,
    paidCents,
    settledCents,
    incurredCents: paidCents + reserveCents,
    isClosed,
    hasReserve,
  };
}

function requireAmount(event: ClaimMoneyEvent, amountCents: number | null): number {
  if (amountCents === null || !Number.isSafeInteger(amountCents)) {
    throw new Error(`claim event ${event.eventType} needs a whole number of cents, got ${String(amountCents)}`);
  }
  return amountCents;
}

// What the journal will book when the reserve is set to a new outstanding level: the difference
// between the level asked for and the level in force. Positive means more expense, negative
// means expense given back, zero means the adjuster changed nothing and no entry is posted.
export function reserveAdjustmentDeltaCents(currentReserveCents: number, newReserveCents: number): number {
  if (!Number.isSafeInteger(newReserveCents) || newReserveCents < 0) {
    throw new Error(`a reserve must be a whole non-negative number of cents, got ${newReserveCents}`);
  }
  return newReserveCents - currentReserveCents;
}
