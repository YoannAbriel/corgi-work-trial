-- 0003: seal journal entries, forbid TRUNCATE, server-set received_at, livemode check.
-- Answers review findings F-B1-01 (HIGH), F-B1-03 (MEDIUM) and two LOW items in
-- docs/reviews/b1-ledger-core.md. Numbered 0003 because 0002 is reserved for slice B2,
-- built in parallel; the runner applies files by name, each exactly once.

-- ---------------------------------------------------------------------------
-- F-B1-01: lines may only be added in the transaction that created their header.
-- Without this, a balanced pair of lines could be appended to a historical entry with no
-- UPDATE, no reversal and no recording time, silently changing what the ledger said.
-- Rule: a journal entry is sealed the moment its transaction commits. Postgres' now() is
-- the start time of the current transaction, and the header's recorded_at was set from
-- that same clock by the 0001 trigger, so "same transaction" is exactly
-- header.recorded_at = now(). A later transaction always has a different now().
-- ---------------------------------------------------------------------------

create or replace function forbid_lines_on_sealed_entry() returns trigger
language plpgsql as $$
declare
  header_recorded_at timestamptz;
begin
  select recorded_at into header_recorded_at from journal_entries where id = new.entry_id;
  if header_recorded_at is null then
    raise exception 'journal entry % does not exist', new.entry_id;
  end if;
  if header_recorded_at <> now() then
    raise exception 'journal entry % is sealed: lines can only be added in the transaction that created it (correct with a reversal entry)', new.entry_id
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger journal_lines_only_in_creating_transaction
  before insert on journal_lines
  for each row execute function forbid_lines_on_sealed_entry();

-- ---------------------------------------------------------------------------
-- F-B1-03: TRUNCATE is not an UPDATE or DELETE, so the 0001 row triggers do not see it.
-- app_runtime never had the privilege; this closes the door for the owner too.
-- ---------------------------------------------------------------------------

create or replace function forbid_truncate_of_financial_record() returns trigger
language plpgsql as $$
begin
  raise exception 'financial records are append-only: TRUNCATE on % is not allowed', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger accounts_never_truncated
  before truncate on accounts
  execute function forbid_truncate_of_financial_record();
create trigger journal_entries_never_truncated
  before truncate on journal_entries
  execute function forbid_truncate_of_financial_record();
create trigger journal_lines_never_truncated
  before truncate on journal_lines
  execute function forbid_truncate_of_financial_record();
create trigger webhook_events_never_truncated
  before truncate on webhook_events
  execute function forbid_truncate_of_financial_record();

-- ---------------------------------------------------------------------------
-- LOW: received_at is set by the database clock, like recorded_at on the journal.
-- ---------------------------------------------------------------------------

create or replace function set_received_at_from_database_clock() returns trigger
language plpgsql as $$
begin
  new.received_at := now();
  return new;
end;
$$;

create trigger webhook_events_received_at_is_server_set
  before insert on webhook_events
  for each row execute function set_received_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- LOW (AF-04 at the database boundary): a live-mode provider event can never be stored,
-- whatever the application code does.
-- ---------------------------------------------------------------------------

alter table webhook_events
  add constraint webhook_events_are_test_mode_only check (livemode = false);
