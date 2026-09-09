-- 0023: the sixth classification, "probe" (decision by Yoann, 2026-09-09).
--
-- WIDENING ONLY, and it is the shape migrations 0007, 0009, 0010, 0014, 0018 and 0020 already
-- use: the CHECK on reconciliation_items.classification gains one value, nothing is removed, and
-- no row is written or changed. An item stored as 'provider_only' before today keeps that
-- classification and reads exactly as before; the column means what it always meant, which
-- comparison outcome a run recorded for one record.
--
-- WHAT A PROBE IS. scripts/check-reconciliation.ts proves that money at Stripe with no operation
-- id behind it is found by the comparison, and to prove it against the real sandbox it CREATES
-- such a payment on every run: 4242 cents, a Stripe test card, no metadata naming any operation.
-- Those payments are real Stripe objects that no ledger entry will ever explain, so every run
-- reported every one of them as a provider-only break for ever. On the deployed application they
-- were the entire open break list, 28 of them, and nothing said what they were (review finding
-- F-YA-10). They are now their own classification: still stored, still listed, under their own
-- heading, and not counted as breaks to act on. The rule that recognises one is a single function
-- with its reasons written beside it (lib/reconciliation/diff.ts, isProbeFromACheckRun).
alter table reconciliation_items drop constraint reconciliation_items_classification_check;
alter table reconciliation_items add constraint reconciliation_items_classification_check
  check (classification in ('matched', 'local_only', 'provider_only', 'amount_mismatch', 'stale', 'probe'));

-- How many probes a run classified, next to the five counts migration 0011 already stores.
--
-- WHY NULLABLE, AND WHAT NULL MEANS. reconciliation_runs is a protected append-only record, so a
-- migration may add a column but must never write a value into rows that already exist. Every run
-- stored before today therefore carries NULL, which reads as "this run recorded no probe count":
-- it classified no item as a probe, because the classification did not exist, and the payments
-- that are probes today are inside its provider_only_count. The reader treats NULL as zero for
-- that reason and the run list keeps showing the counts each run actually stored.
alter table reconciliation_runs add column probe_count integer check (probe_count >= 0);

-- A failed run compared nothing, so it counts nothing here either. Stated as its own constraint
-- rather than by touching the CHECK of 0011, which stays exactly as it was written.
alter table reconciliation_runs add constraint reconciliation_runs_failed_runs_count_no_probe
  check (status = 'complete' or coalesce(probe_count, 0) = 0);
