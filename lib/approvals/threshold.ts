// The maker-checker threshold, in one place.
//
// $1,000 of money-out needs a second, different human being to approve it before anything
// leaves. Decided by Yoann on 2026-09-08 (DECISIONS.md, 08:04): "money-out (claim payments and
// refunds) above $1,000 requires a distinct human approver, never the initiator and never an
// agent". Rejected alternatives were $500, $250, and an approval on every amount.
//
// THIS IS AN ASSUMPTION OF THIS BUILD, NOT A REGULATORY FACT. No law, no rail rule and no Corgi
// instruction sets it. It is written here once, so there is exactly one number to change and
// exactly one number to defend.
export const MONEY_OUT_APPROVAL_THRESHOLD_CENTS = 100000;

// "Above $1,000" means strictly above: a payment of exactly $1,000.00 goes out without an
// approver, a payment of $1,000.01 does not. One comparison, written once, used by the claim
// payment path, the refund path and both screens, so no entry point can read the rule
// differently from another.
export function moneyOutNeedsApproval(amountCents: number): boolean {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`a money-out amount must be a positive whole number of cents, got ${amountCents}`);
  }
  return amountCents > MONEY_OUT_APPROVAL_THRESHOLD_CENTS;
}
