-- 0004: TRUNCATE guards for the protected tables created by migration 0002.
--
-- Why a separate file rather than an edit of 0002: 0002 had already been applied to the shared
-- database when the ledger review asked for TRUNCATE guards on every protected table. The
-- migration runner applies each file once by name, so editing an applied file would leave the
-- shared database without the new statements while a fresh database received them. Adding a
-- file keeps both identical and keeps the record honest.
--
-- The UPDATE and DELETE trigger (0002) stops row changes; this one stops the statement that
-- empties a table without touching rows. app_runtime is not granted TRUNCATE either, so this
-- guard exists for the owner connection: a migration, a seed script or a console session.

-- Same function as the one migration 0003 defines for the tables of 0001. Written with
-- CREATE OR REPLACE and an identical body in both files, so the order in which they run does
-- not matter and neither file depends on the other.
create or replace function forbid_truncate_of_financial_record() returns trigger
language plpgsql as $$
begin
  raise exception 'financial records are append-only: TRUNCATE on % is not allowed', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger brokers_cannot_be_truncated
  before truncate on brokers
  for each statement execute function forbid_truncate_of_financial_record();

create trigger policies_cannot_be_truncated
  before truncate on policies
  for each statement execute function forbid_truncate_of_financial_record();

create trigger policy_events_cannot_be_truncated
  before truncate on policy_events
  for each statement execute function forbid_truncate_of_financial_record();

create trigger money_operations_cannot_be_truncated
  before truncate on money_operations
  for each statement execute function forbid_truncate_of_financial_record();

create trigger money_operation_events_cannot_be_truncated
  before truncate on money_operation_events
  for each statement execute function forbid_truncate_of_financial_record();

create trigger state_tax_rates_cannot_be_truncated
  before truncate on state_tax_rates
  for each statement execute function forbid_truncate_of_financial_record();

create trigger broker_kyb_events_cannot_be_truncated
  before truncate on broker_kyb_events
  for each statement execute function forbid_truncate_of_financial_record();
