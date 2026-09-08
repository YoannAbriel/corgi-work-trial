import type postgres from "postgres";
import type { LedgerRecord, ProviderRecord } from "./diff";
import type { ReconciliationSourceName } from "./breaks";
import type { ReconciliationWindow } from "./window";

// What a provider has to expose to be reconciled. One module per provider implements this; the
// run (lib/reconciliation/run.ts) and the diff (lib/reconciliation/diff.ts) never learn which
// provider they are looking at.
//
// Two sources exist:
//   'stripe'       lib/reconciliation/stripe-source.ts, a real network listing of the test-mode
//                  sandbox: PaymentIntents, Refunds and BalanceTransactions;
//   'claims_rail'  lib/reconciliation/claims-rail-source.ts, the LOCAL SIMULATOR's own
//                  provider-side table simulator_provider_records, read with no network at all.
// They are two implementations of the same three fields, so the job code below them is one code
// path and a third provider would only add a file.
export type ReconciliationSource = {
  name: ReconciliationSourceName;
  // How long money-out may stay unconfirmed before the run calls it stale. Per source because
  // the rails take different times: Stripe answers a refund in hours, the simulated claim rail
  // settles in two calendar days. Both figures are ASSUMPTIONS of this build, not provider
  // guarantees; they are flagged for Yoann in docs/handoffs/b10-implementation-notes.md.
  staleAfterHours: number;
  // The provider's own records created inside the window. Throws on any provider error: the run
  // then stores a failed run, never an empty clean one.
  fetch(window: ReconciliationWindow): Promise<{ records: ProviderRecord[]; note: string }>;
  // The ledger's view of the same money, read with the runtime role.
  readLedger(window: ReconciliationWindow, database: postgres.Sql): Promise<LedgerRecord[]>;
};
