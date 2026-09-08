-- 0011: reconciliation runs and items (slice B10).
-- Strictly additive: it creates two tables, one trigger function and the grants. Nothing from
-- 0001 to 0010 is dropped or altered, and no object it creates references a table added by
-- 0008 (claims, slice B7) or by the endorsement migration of slice B4, so the files apply in any
-- order.
--
-- What reconciliation is here: a job pulls a provider's own records for a time window (Stripe,
-- and the simulated claim payout rail of slice B7), reads what the ledger says about the same
-- money, and stores the comparison. The job never changes the ledger: a break is something a
-- human looks at, and a repair is a new operation or a reversal, never an edit.
--
-- Both tables are protected financial records in the same sense as webhook_events: they are
-- what we knew about the provider at a given moment, and rewriting them would let a break
-- disappear without anyone having fixed it. Same three guards as every protected table:
--   1. a BEFORE UPDATE OR DELETE trigger that raises for every role, owner included;
--   2. a BEFORE TRUNCATE trigger;
--   3. the recording time set from the database clock, never from the client.
-- app_runtime receives SELECT and INSERT only.

-- ---------------------------------------------------------------------------
-- Server-clock trigger for finished_at
-- ---------------------------------------------------------------------------

-- Same idea as set_recorded_at_from_database_clock() (0001) and
-- set_created_at_from_database_clock() (0002), for the column named finished_at. One small
-- function per column name, so each stays readable on its own.
create or replace function set_finished_at_from_database_clock() returns trigger
language plpgsql as $$
begin
  new.finished_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- reconciliation_runs: one row per execution of the job, complete or failed
-- ---------------------------------------------------------------------------

create table reconciliation_runs (
  id                    uuid primary key default gen_random_uuid(),
  -- Which provider was compared: Stripe (LIVE SANDBOX) or the simulated claim payout rail of
  -- slice B7 (LOCAL SIMULATOR, its own provider-side table simulator_provider_records).
  source                text not null check (source in ('stripe', 'claims_rail')),
  -- The provider records compared are those created inside [window_from, window_to]; the
  -- ledger records are those with activity recorded inside the same window. UTC instants.
  window_from           timestamptz not null,
  window_to             timestamptz not null,
  -- When the application started fetching (its own clock, informational) and when the row was
  -- written (database clock, the booking time of the result). The fetch happens BEFORE the row
  -- exists, so started_at cannot be server-set; finished_at is.
  started_at            timestamptz not null,
  finished_at           timestamptz not null default now(),  -- overwritten by the trigger below
  -- 'complete': the provider answered and the comparison was stored.
  -- 'failed': the provider (or the ledger read) raised; fetch_error says what, and there are
  -- NO items, so a failed run can never be read as "zero breaks".
  status                text not null check (status in ('complete', 'failed')),
  fetch_error           text,
  -- How many items of each classification the run stored. Redundant with a count over
  -- reconciliation_items, kept so the run list needs no join; the CHECK below keeps a failed
  -- run at zero everywhere.
  matched_count         integer not null default 0 check (matched_count >= 0),
  local_only_count      integer not null default 0 check (local_only_count >= 0),
  provider_only_count   integer not null default 0 check (provider_only_count >= 0),
  amount_mismatch_count integer not null default 0 check (amount_mismatch_count >= 0),
  stale_count           integer not null default 0 check (stale_count >= 0),
  -- How many records each side contributed, so a complete run with zero breaks also says how
  -- much it actually compared (a run that compared nothing is not evidence of anything).
  provider_record_count integer not null default 0 check (provider_record_count >= 0),
  ledger_record_count   integer not null default 0 check (ledger_record_count >= 0),
  -- Free text from the source, for example which balance transaction types were seen and
  -- deliberately not journaled (Stripe fees and payouts, disclosed in README).
  note                  text,
  -- The user id of the staff member who pressed "Run now"; null when the daily cron ran it.
  run_by                text,
  check (window_from < window_to),
  -- A failed run carries its error and nothing else; a complete run carries no error.
  check ((status = 'failed') = (fetch_error is not null)),
  check (status = 'complete'
         or (matched_count + local_only_count + provider_only_count + amount_mismatch_count + stale_count
             + provider_record_count + ledger_record_count) = 0)
);

create index reconciliation_runs_by_source_and_time on reconciliation_runs (source, finished_at desc);

create trigger reconciliation_runs_are_append_only
  before update or delete on reconciliation_runs
  for each row execute function forbid_change_of_financial_record();

create trigger reconciliation_runs_cannot_be_truncated
  before truncate on reconciliation_runs
  for each statement execute function forbid_truncate_of_financial_record();

create trigger reconciliation_runs_finished_at_is_server_set
  before insert on reconciliation_runs
  for each row execute function set_finished_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- reconciliation_items: one row per record compared, in one run
-- ---------------------------------------------------------------------------

-- Every provider record and every ledger record of a run produces exactly one item, matched or
-- not, so the counts on the run add up to what was compared. A break is any item whose
-- classification is not 'matched'.
create table reconciliation_items (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references reconciliation_runs (id),
  classification        text not null check (classification in
                          ('matched', 'local_only', 'provider_only', 'amount_mismatch', 'stale')),
  -- The identity of a break across runs: source, classification and the reference it is
  -- about (lib/reconciliation/breaks.ts, breakKey). Two runs reporting the same key report the
  -- same break, which is how the screen knows how old it is and when it went away.
  break_key             text not null,
  provider_ref          text,        -- Stripe PaymentIntent or Refund id, later a rail transfer id
  ledger_ref            text,        -- money_operations.id the ledger side of the item is about
  -- Signed cash movements at the provider, in cents: money in is positive, money out negative.
  -- provider_amount_cents is what the provider shows, ledger_amount_cents what the journal
  -- shows on the cash account, difference_cents is provider minus ledger. Null on a side that
  -- has no record at all.
  provider_amount_cents bigint,
  ledger_amount_cents   bigint,
  difference_cents      bigint,
  -- The finished_at of the EARLIEST run that reported this break_key, copied here at insert
  -- time (lib/reconciliation/run.ts): the age of a break is now() minus this value. For a
  -- matched item it is simply this run's time.
  first_seen_at         timestamptz not null,
  note                  text not null,
  recorded_at           timestamptz not null default now()  -- overwritten by the trigger below
);

create index reconciliation_items_by_run on reconciliation_items (run_id);
create index reconciliation_items_by_break_key on reconciliation_items (break_key);

create trigger reconciliation_items_are_append_only
  before update or delete on reconciliation_items
  for each row execute function forbid_change_of_financial_record();

create trigger reconciliation_items_cannot_be_truncated
  before truncate on reconciliation_items
  for each statement execute function forbid_truncate_of_financial_record();

create trigger reconciliation_items_recorded_at_is_server_set
  before insert on reconciliation_items
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- Grants: the job reads the ledger with the runtime role and appends here, nothing else
-- ---------------------------------------------------------------------------

grant select, insert on reconciliation_runs, reconciliation_items to app_runtime;
