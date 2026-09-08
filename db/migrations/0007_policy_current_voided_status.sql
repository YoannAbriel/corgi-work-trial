-- 0007: the policy_current cache learns the status 'voided'.
--
-- Why a separate file rather than an edit of 0006: 0006 had already been applied to the trial
-- database and to corgi_test when the B2 re-review (finding F-B2-13) asked for the voided
-- status. The migration runner applies each file once by name, so editing an applied file
-- would leave those databases without the new statement while a fresh database received it.
-- Adding a file keeps all three identical, which is the same reason migration 0004 exists.
--
-- Why altering a CHECK constraint is allowed here, when the rest of this schema is strictly
-- additive: policy_current is not a financial record. It is a rebuildable cache of the fold of
-- policy_events (0002 says so in its comment, and scripts/rebuild-policy-current.ts rebuilds
-- it), no balance is ever read from it, and it is the one table the application may UPDATE.
-- The protected tables are untouched by this migration.
--
-- What 'voided' means: a correction reversed the policy's issuance and nothing has re-booked
-- it, so the fold no longer applies the superseded 'issued' event (lib/policy/status.ts,
-- policyWasVoided). Without this value the cache refresh inside a void would fail the CHECK,
-- and without the status the policy would read as 'payment_failed', which hides the correction
-- and lets the broker start paying it again.

alter table policy_current drop constraint policy_current_status_check;

alter table policy_current
  add constraint policy_current_status_check
  check (status in ('draft', 'awaiting_payment', 'payment_failed', 'bound', 'cancelled', 'voided'));
