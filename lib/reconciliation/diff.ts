import { CLASSIFICATIONS, hoursBetween, type Classification } from "./breaks";

// The comparison itself. PURE: two lists in, one list of classified items out. No database, no
// provider, no clock of its own (`now` is an argument), so every rule below is a unit test.
//
// Both sides describe the same thing, a movement of cash at the provider, in the same units:
//   - a ProviderRecord is what the provider says happened (a Stripe PaymentIntent or Refund,
//     or one transfer on the simulated claim payout rail);
//   - a LedgerRecord is what our journal says about one money operation: the signed net
//     movement of the cash account (cash_stripe or cash_claims_rail) filed under it,
//     reversals included, so a voided operation nets to zero.
// Money in (a payment collected) is positive, money out (a refund, a claim payout) is negative.
// Stripe fees are NOT in either figure: cash_stripe is gross of fees and fees are not journaled
// (disclosed in README, design finding F-13), so the fee is carried on the item as information.
//
// The five classifications, one item per record compared:
//   matched          same operation, same signed amount (or nothing moved on either side yet)
//   local_only       the ledger shows cash for an operation the provider shows nothing for
//   provider_only    the provider shows money that moved and the ledger shows no cash for it
//   amount_mismatch  same operation, both sides moved money, different amounts (difference signed)
//   stale            money out promised more than `staleAfterHours` ago and still not confirmed
//
// Worked example (the recited policy, DECISIONS.md): the ledger holds a stripe_checkout
// operation with cash_stripe +125320 and Stripe lists PaymentIntent pi_1 of 125320 carrying
// that operation id in its metadata, with a fee of 3934 on its balance transaction. Result: one
// matched item, provider +125320, ledger +125320, difference 0, note "Stripe kept a fee of
// 3934 cents". If Stripe listed 125000 instead: amount_mismatch, difference -320 (provider
// minus ledger: Stripe holds 320 cents less than the books say).

export type CashDirection = "in" | "out";

export type ProviderRecord = {
  providerRef: string; // pi_... or re_... at Stripe; sim_tr_... on the claim payout rail
  direction: CashDirection; // in: money collected; out: money sent (refund, claim payout)
  // The three outcomes the comparison reasons about. Every provider status is folded to one of
  // them by its own source module, so this file never learns a provider's vocabulary.
  status: "succeeded" | "pending" | "failed";
  // The provider's OWN word for that status ("succeeded", "canceled", "returned", ...), used in
  // the notes only. It exists because "failed" covers two different stories, a Stripe refund
  // that never left and a rail transfer the receiving bank sent back, and an operator reading a
  // break deserves the real word.
  statusWord: string;
  amountCents: number; // always positive; `direction` gives the sign
  createdAt: string; // ISO instant, the provider's own clock
  operationId: string | null; // our money_operations.id when the provider carries it back
  policyId: string | null;
  feeCents: number | null; // what the provider kept on a payment; information only
  label: string; // "payment", "refund", "claim payout": used in the notes
};

export type LedgerRecord = {
  operationId: string;
  direction: CashDirection;
  policyId: string | null;
  providerRef: string | null; // the provider id the operation recorded, once it knows one
  expectedCents: number; // the amount the operation intended to move
  cashCents: number; // signed net movement of the cash account filed under this operation
  // Signed net movement of this operation's CLEARING account: premium_receivable for a
  // checkout, refund_payable for a refund, claims_payable for a claim payout. Zero means the
  // flow is finished in the books; anything else is an obligation still open on our side, which
  // is what tells "a refund we asked for and never paid" apart from "a refund we never heard
  // of" (AGENTS.md, reconciliation: clearing accounts must return to zero).
  openClearingCents: number;
  reversed: boolean; // a correction reversed this operation's entries
  state: string; // the lifecycle state as the ledger side reads it, for the notes
  requestedAt: string; // ISO instant, when the operation was created
  label: string; // "checkout", "refund", "claim payout"
};

export type DiffItem = {
  classification: Classification;
  providerRef: string | null;
  ledgerRef: string | null; // the money operation id
  providerAmountCents: number | null; // signed
  ledgerAmountCents: number | null; // signed
  differenceCents: number | null; // provider minus ledger, a missing side counting as zero
  // WHEN THE COMPARED RECORD BELONGS. ISO instant. This is what lets a later run say whether it
  // actually re-examined a break or simply did not look at it: a run only resolves a break whose
  // record date falls inside its window (review finding F-B10-01, lib/reconciliation/read.ts).
  // The provider's own created time when there is a provider record, because the provider is the
  // authority on when its money moved; the money operation's created time otherwise.
  recordAt: string;
  note: string;
};

export type DiffInput = {
  provider: ProviderRecord[];
  ledger: LedgerRecord[];
  now: Date;
  staleAfterHours: number;
};

// Lifecycle states in which nothing more is expected from the provider for this operation, so
// waiting is not "stale": the money is dead and a new operation is what moves it, not patience.
// 'failed' is a refund Stripe refused; 'returned' is a rail transfer the bank sent back.
const NOTHING_MORE_EXPECTED = new Set(["failed", "returned"]);

export function diffProviderAgainstLedger(input: DiffInput): DiffItem[] {
  const ledgerByOperation = new Map(input.ledger.map((record) => [record.operationId, record]));

  // TWO LEDGER RECORDS CANNOT SHARE ONE PROVIDER REFERENCE and both be the thing the provider is
  // describing. Building this index with `new Map(...)` kept the last of them and dropped the
  // other from the pairing without a word, so a provider record could be matched against the
  // wrong operation (review finding F-B10-09). No path in this build produces it, since every
  // operation gets its own PaymentIntent, refund or transfer, which is why this is defensive
  // rather than a rule to be clever about: a shared reference stops being a usable link, and
  // every record involved is reported instead of one of them being chosen silently.
  const ledgerByProviderRef = new Map<string, LedgerRecord>();
  const sharedProviderRefs = new Set<string>();
  for (const record of input.ledger) {
    if (record.providerRef === null) {
      continue;
    }
    if (ledgerByProviderRef.has(record.providerRef)) {
      sharedProviderRefs.add(record.providerRef);
      continue;
    }
    ledgerByProviderRef.set(record.providerRef, record);
  }

  const ledgerAlreadyPaired = new Set<string>();
  const items: DiffItem[] = [];

  // 1. Every provider record, paired with its ledger record when there is one. The operation id
  //    the provider carries back is the primary link; the provider's own id is the fallback for
  //    a record whose metadata was lost but whose id the ledger recorded from a webhook, and it
  //    is the ONLY link on the claim payout rail, which carries no operation id at all.
  for (const providerRecord of input.provider) {
    const byOperation = providerRecord.operationId ? ledgerByOperation.get(providerRecord.operationId) : undefined;
    // The operation id the provider carries back still decides on its own; only the FALLBACK on
    // the provider's id is refused when several ledger records claim that id.
    const refIsShared = sharedProviderRefs.has(providerRecord.providerRef);
    const byProviderRef = refIsShared ? undefined : ledgerByProviderRef.get(providerRecord.providerRef);
    const ledgerRecord = byOperation ?? byProviderRef;
    if (ledgerRecord && !ledgerAlreadyPaired.has(ledgerRecord.operationId)) {
      ledgerAlreadyPaired.add(ledgerRecord.operationId);
      items.push(classifyPair(providerRecord, ledgerRecord, input));
    } else {
      items.push(classifyProviderAlone(providerRecord, refIsShared && !byOperation));
    }
  }

  // 2. Every ledger record the provider said nothing about.
  for (const ledgerRecord of input.ledger) {
    if (!ledgerAlreadyPaired.has(ledgerRecord.operationId)) {
      items.push(
        classifyLedgerAlone(ledgerRecord, input, ledgerRecord.providerRef !== null && sharedProviderRefs.has(ledgerRecord.providerRef)),
      );
    }
  }

  return items;
}

// Money in is positive, money out is negative, on both sides.
function signedProviderAmount(record: ProviderRecord): number {
  return record.direction === "in" ? record.amountCents : -record.amountCents;
}

function classifyPair(provider: ProviderRecord, ledger: LedgerRecord, input: DiffInput): DiffItem {
  const providerAmount = signedProviderAmount(provider);
  const item = (classification: Classification, note: string): DiffItem => ({
    classification,
    providerRef: provider.providerRef,
    ledgerRef: ledger.operationId,
    providerAmountCents: providerAmount,
    ledgerAmountCents: ledger.cashCents,
    differenceCents: providerAmount - ledger.cashCents,
    recordAt: provider.createdAt,
    note,
  });

  if (provider.status === "succeeded") {
    if (ledger.cashCents === providerAmount) {
      return item("matched", `${provider.label} agrees with the ledger${feeNote(provider)}`);
    }
    if (ledger.cashCents === 0) {
      return item(
        "provider_only",
        ledger.reversed
          ? `the provider shows a ${provider.statusWord} ${provider.label} for operation ${ledger.operationId}, whose journal entries were reversed by a correction: real money with nothing left in the ledger`
          : `the provider shows a ${provider.statusWord} ${provider.label} and the ledger shows no cash movement for operation ${ledger.operationId} (ledger state: ${ledger.state}${openClearingNote(ledger)}); a missing webhook or an unrun settlement job is the usual cause`,
      );
    }
    return item(
      "amount_mismatch",
      `same operation, different amounts: the provider moved ${providerAmount} cents and the ledger booked ${ledger.cashCents} cents`,
    );
  }

  if (provider.status === "pending") {
    if (ledger.cashCents !== 0) {
      return item("amount_mismatch", `the ledger booked ${ledger.cashCents} cents of cash for a ${provider.label} the provider still shows as ${provider.statusWord}`);
    }
    const pendingHours = hoursBetween(new Date(provider.createdAt), input.now);
    if (pendingHours > input.staleAfterHours) {
      return item("stale", `${provider.label} still ${provider.statusWord} at the provider ${pendingHours} hours after it was created, longer than the ${input.staleAfterHours}-hour threshold`);
    }
    return item("matched", `${provider.label} in flight at the provider for ${pendingHours} hours (${provider.statusWord}), nothing booked yet on either side`);
  }

  // provider.status === "failed": the provider is done and no money stayed out.
  if (ledger.cashCents !== 0) {
    return item("amount_mismatch", `the ledger booked ${ledger.cashCents} cents of cash for a ${provider.label} the provider reports as ${provider.statusWord}`);
  }
  return item(
    "matched",
    ledger.direction === "out"
      ? `${provider.label} ${provider.statusWord} at the provider, no cash stayed out; the amount is still owed and stays open in the ledger until it is re-issued (${openClearingNote(ledger) || "nothing open on the clearing account"})`
      : `${provider.label} ${provider.statusWord} at the provider, no cash moved on either side`,
  );
}

// `refIsShared`: more than one ledger record carries this provider's id, so the id could not be
// used to pair it and an operator has to look at the operations involved by hand.
function classifyProviderAlone(provider: ProviderRecord, refIsShared = false): DiffItem {
  const providerAmount = signedProviderAmount(provider);
  const item = (classification: Classification, note: string): DiffItem => ({
    classification,
    providerRef: provider.providerRef,
    ledgerRef: null,
    providerAmountCents: providerAmount,
    ledgerAmountCents: null,
    differenceCents: providerAmount,
    recordAt: provider.createdAt,
    note,
  });
  const identity = refIsShared
    ? "MORE THAN ONE LEDGER RECORD CARRIES THIS PROVIDER REFERENCE, so it cannot be used to pair this record; the operations that carry it are reported on their own lines"
    : provider.operationId
      ? `it names operation ${provider.operationId}, which the ledger does not know`
      : "it carries no operation id at all";

  if (provider.status === "failed") {
    return item("matched", `${provider.label} ${provider.statusWord} at the provider and no money stayed out; nothing was expected in the ledger (${identity})`);
  }
  if (provider.status === "pending") {
    return item("provider_only", `${provider.label} ${provider.statusWord} at the provider with no ledger operation behind it; ${identity}`);
  }
  return item("provider_only", `the provider shows a ${provider.statusWord} ${provider.label} of ${provider.amountCents} cents with no cash movement in the ledger; ${identity}`);
}

function classifyLedgerAlone(ledger: LedgerRecord, input: DiffInput, refIsShared = false): DiffItem {
  // Said on every line of a shared reference, so the two halves of the problem name each other.
  const sharedRefNote = refIsShared
    ? "; ANOTHER LEDGER RECORD CARRIES THE SAME PROVIDER REFERENCE, so the reference could not pair either of them"
    : "";
  const item = (classification: Classification, note: string): DiffItem => ({
    classification,
    providerRef: ledger.providerRef,
    ledgerRef: ledger.operationId,
    providerAmountCents: null,
    ledgerAmountCents: ledger.cashCents,
    differenceCents: -ledger.cashCents,
    // No provider record, so the money operation's own creation time is the date of this record.
    recordAt: ledger.requestedAt,
    note: `${note}${sharedRefNote}`,
  });

  if (ledger.cashCents !== 0) {
    return item(
      "local_only",
      `the ledger shows ${ledger.cashCents} cents on the cash account for ${ledger.label} operation ${ledger.operationId} and the provider shows no record for it in the window`,
    );
  }
  if (ledger.reversed) {
    return item("matched", `${ledger.label} reversed by a correction: the ledger nets to zero and the provider shows nothing, as expected`);
  }
  if (ledger.direction === "out" && !NOTHING_MORE_EXPECTED.has(ledger.state)) {
    const waitingHours = hoursBetween(new Date(ledger.requestedAt), input.now);
    if (waitingHours > input.staleAfterHours) {
      return item(
        "stale",
        `${ledger.label} requested ${waitingHours} hours ago (ledger state: ${ledger.state}) and never confirmed by the provider; the amount is still owed${openClearingNote(ledger)}`,
      );
    }
    return item("matched", `${ledger.label} requested ${waitingHours} hours ago (ledger state: ${ledger.state}), not confirmed yet, under the ${input.staleAfterHours}-hour threshold`);
  }
  return item("matched", `${ledger.label} operation ${ledger.operationId} moved no cash on either side (ledger state: ${ledger.state})`);
}

function feeNote(provider: ProviderRecord): string {
  if (provider.feeCents === null) {
    return "";
  }
  return `; the provider kept a fee of ${provider.feeCents} cents on it, information only: the cash account is gross of fees and fees are not journaled (disclosed)`;
}

// Says how much of this operation is still open on its clearing account, or nothing at all when
// the books are square. Written as a sentence fragment so the notes above read as one sentence.
function openClearingNote(ledger: LedgerRecord): string {
  if (ledger.openClearingCents === 0) {
    return "";
  }
  return `, ${Math.abs(ledger.openClearingCents)} cents still open on the ledger's clearing account for it`;
}

// How many items of each classification, for the run summary.
export function countByClassification(items: DiffItem[]): Record<Classification, number> {
  const counts = Object.fromEntries(CLASSIFICATIONS.map((name) => [name, 0])) as Record<Classification, number>;
  for (const item of items) {
    counts[item.classification] += 1;
  }
  return counts;
}
