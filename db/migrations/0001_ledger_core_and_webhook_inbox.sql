-- 0001: ledger core and webhook inbox.
-- Money is bigint cents. Protected (append-only) tables get two independent guards:
--   1. a BEFORE UPDATE OR DELETE trigger that raises, for every role including the owner;
--   2. the runtime role app_runtime, which only receives SELECT and INSERT on them.
-- The application connects as app_runtime. Migrations and the seed connect as the owner.

-- ---------------------------------------------------------------------------
-- Guard functions
-- ---------------------------------------------------------------------------

-- Raises on any UPDATE or DELETE of a protected table (AF-03).
create or replace function forbid_change_of_financial_record() returns trigger
language plpgsql as $$
begin
  raise exception 'financial records are append-only: % on % is not allowed (correct with a reversal entry)', tg_op, tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

-- Sets recorded_at from the database clock so a client can never backdate the booking time.
create or replace function set_recorded_at_from_database_clock() returns trigger
language plpgsql as $$
begin
  new.recorded_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------

create table accounts (
  id   text primary key,                          -- stable identifier used in code, e.g. 'cash_stripe'
  name text not null,
  side text not null check (side in ('debit', 'credit'))  -- which side increases the balance
);

create trigger accounts_are_append_only
  before update or delete on accounts
  for each row execute function forbid_change_of_financial_record();

insert into accounts (id, name, side) values
  ('cash_stripe',               'Cash held at Stripe (gross of Stripe fees)',            'debit'),
  ('premium_receivable',        'Premium, tax and fee billed and not yet collected',     'debit'),
  ('unearned_premium',          'Written premium not yet earned (owed back on cancel)',  'credit'),
  ('earned_premium',            'Premium earned to date',                                'credit'),
  ('premium_tax_payable',       'State premium tax collected, owed to the state',        'credit'),
  ('fee_income',                'Flat policy fee, fully earned at issuance',             'credit'),
  ('commission_expense',        'Broker commission on collected premium',                'debit'),
  ('commission_payable',        'Commission owed to brokers, reduced by clawbacks',      'credit'),
  ('refund_payable',            'Refunds requested at Stripe and not yet completed',     'credit'),
  ('customer_credit',           'Credit owed to a customer (negative endorsement)',      'credit'),
  ('claim_reserve',             'Open case reserves (estimates)',                        'credit'),
  ('incurred_loss_expense',     'Claims expense recognised when a reserve is set',       'debit'),
  ('claims_payable',            'Claim payments sent and not yet settled on the rail',   'credit'),
  ('cash_claims_rail',          'Money at the claim payout rail after settlement',       'debit'),
  ('short_rate_penalty_income', 'Short-rate cancellation penalty (representable, unused)', 'credit');

-- ---------------------------------------------------------------------------
-- Journal: one header per business event, lines that must balance
-- ---------------------------------------------------------------------------

create table journal_entries (
  id                 uuid primary key default gen_random_uuid(),
  entry_type         text not null,               -- e.g. 'premium_written', 'premium_collected', 'reversal'
  effective_at       date not null,               -- business date the entry belongs to (as-of queries)
  recorded_at        timestamptz not null default now(),  -- booking time, overwritten by trigger
  policy_id          uuid,
  claim_id           uuid,
  broker_id          uuid,
  source_kind        text not null,               -- 'money_operation', 'policy_event', 'statement_run', 'correction'
  source_id          text not null,               -- id of that source
  reverses_entry_id  uuid unique references journal_entries (id),  -- set only on reversal entries
  created_by         text,                        -- user id of the human who caused the entry, null for provider events
  description        text not null,
  -- The same source can produce a given entry type only once: a replayed webhook or a
  -- retried operation hits this constraint instead of posting twice.
  unique (source_kind, source_id, entry_type)
);

create trigger journal_entries_are_append_only
  before update or delete on journal_entries
  for each row execute function forbid_change_of_financial_record();

create trigger journal_entries_recorded_at_is_server_set
  before insert on journal_entries
  for each row execute function set_recorded_at_from_database_clock();

create table journal_lines (
  id           bigserial primary key,
  entry_id     uuid not null references journal_entries (id),
  account_id   text not null references accounts (id),
  debit_cents  bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  -- exactly one side is positive on every line
  check ((debit_cents > 0) <> (credit_cents > 0))
);

create index journal_lines_by_entry on journal_lines (entry_id);
create index journal_lines_by_account on journal_lines (account_id);

create trigger journal_lines_are_append_only
  before update or delete on journal_lines
  for each row execute function forbid_change_of_financial_record();

-- Balance check, run at commit time (deferred) so a header and its lines can be inserted
-- in any order inside one transaction. An entry with no lines, or whose debits and credits
-- differ, makes the whole transaction fail.
create or replace function check_journal_entry_balances() returns trigger
language plpgsql as $$
declare
  checked_entry_id uuid;
  total_debit  bigint;
  total_credit bigint;
  line_count   integer;
begin
  -- The same function serves both tables: a new line names its entry, a new header is the entry.
  if tg_table_name = 'journal_lines' then
    checked_entry_id := new.entry_id;
  else
    checked_entry_id := new.id;
  end if;

  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0), count(*)
    into total_debit, total_credit, line_count
    from journal_lines
   where entry_id = checked_entry_id;

  if line_count = 0 then
    raise exception 'journal entry % has no lines', checked_entry_id;
  end if;
  if total_debit <> total_credit then
    raise exception 'journal entry % does not balance: debits % <> credits %', checked_entry_id, total_debit, total_credit;
  end if;
  return null;
end;
$$;

create constraint trigger journal_entry_must_balance
  after insert on journal_lines
  deferrable initially deferred
  for each row execute function check_journal_entry_balances();

create constraint trigger journal_entry_must_have_lines
  after insert on journal_entries
  deferrable initially deferred
  for each row execute function check_journal_entry_balances();

-- ---------------------------------------------------------------------------
-- Webhook inbox: immutable facts, mutable processing metadata kept apart
-- ---------------------------------------------------------------------------

create table webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,               -- 'stripe'
  provider_event_id  text not null,               -- Stripe event id, e.g. 'evt_...'
  event_type         text not null,               -- e.g. 'payment_intent.succeeded'
  livemode           boolean not null,            -- must be false in this trial (AF-04)
  payload            jsonb not null,              -- the verified event, as received
  signature_verified boolean not null,
  received_at        timestamptz not null default now(),
  -- the same provider event is stored once, however many times it is delivered
  unique (provider, provider_event_id)
);

create trigger webhook_events_are_append_only
  before update or delete on webhook_events
  for each row execute function forbid_change_of_financial_record();

-- Nonfinancial and mutable: who is processing the event, how many attempts, last error.
create table webhook_processing (
  webhook_event_id uuid primary key references webhook_events (id),
  status           text not null check (status in ('pending', 'processing', 'done', 'failed', 'ignored')),
  attempts         integer not null default 0,
  last_error       text,
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Runtime role: no UPDATE, DELETE or TRUNCATE on protected tables
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin;
  end if;
end;
$$;

grant usage on schema public to app_runtime;
grant select, insert on accounts, journal_entries, journal_lines, webhook_events to app_runtime;
grant select, insert, update on webhook_processing to app_runtime;
grant usage, select on sequence journal_lines_id_seq to app_runtime;
