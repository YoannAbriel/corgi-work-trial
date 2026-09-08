-- 0002: policies, policy events, money operations, state tax rates, broker KYB, demo users.
-- Strictly additive: it creates new objects only. Nothing from 0001 is dropped or altered.
--
-- Two kinds of table again (see 0001):
--
--   Protected financial records (AF-03), append-only, two independent guards:
--     brokers, policies, policy_events, money_operations, money_operation_events,
--     state_tax_rates, broker_kyb_events
--     1. a BEFORE UPDATE OR DELETE trigger that raises for every role, owner included;
--     2. the runtime role app_runtime, which only receives SELECT and INSERT on them.
--   brokers and policies are protected because they carry facts that decide money:
--   the broker commission rate and the state whose premium tax rate applies. A rate change
--   is a new effective-dated row in a future table, never an UPDATE of these rows.
--
--   Nonfinancial tables: customers, users (identity, no money), policy_current
--   (a cache of the policy fold, rebuilt from policy_events and money_operation_events by
--   lib/policy/current.ts, never an authoritative money record).

-- ---------------------------------------------------------------------------
-- Second server-clock trigger: money_operations.created_at
-- ---------------------------------------------------------------------------

-- Same idea as set_recorded_at_from_database_clock() in 0001, for the column named created_at.
-- Two small functions instead of one generic one: each is readable on its own.
create or replace function set_created_at_from_database_clock() returns trigger
language plpgsql as $$
begin
  new.created_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Parties
-- ---------------------------------------------------------------------------

create table brokers (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  -- 1500 = 15.00%. Commission is earned on collected premium (DECISIONS.md).
  commission_rate_bps integer not null check (commission_rate_bps >= 0 and commission_rate_bps <= 10000),
  created_at          timestamptz not null default now()
);

create trigger brokers_are_append_only
  before update or delete on brokers
  for each row execute function forbid_change_of_financial_record();

-- Nonfinancial: a customer's name and email decide no amount. No editing screen exists in
-- this build, so the runtime role gets SELECT and INSERT only.
create table customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  created_at timestamptz not null default now()
);

-- Demo login accounts. Synthetic people, one shared password from DEMO_PASSWORD; no password
-- material is stored here (see lib/auth/session.ts). Nonfinancial.
create table users (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  display_name text not null,
  role         text not null check (role in ('broker', 'customer', 'staff_ops', 'staff_approver')),
  broker_id    uuid references brokers (id),      -- set for role 'broker'
  customer_id  uuid references customers (id),    -- set for role 'customer'
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Broker KYB eligibility: append-only status events, latest one wins
-- ---------------------------------------------------------------------------

-- Eligibility is unknown while this table holds no event for the broker: binding is refused
-- by default (AGENTS.md, KYC section). Slice B3 fills it from real Stripe Connect events;
-- the seed writes one row explicitly labelled as a development placeholder.
create table broker_kyb_events (
  id              uuid primary key default gen_random_uuid(),
  sequence_number bigserial not null,             -- total order of recording, ties impossible
  broker_id       uuid not null references brokers (id),
  provider        text not null,                  -- 'seed' now, 'stripe_connect' in slice B3
  status          text not null check (status in ('unknown', 'pending', 'approved', 'failed')),
  provider_ref    text,                           -- connected account id, when there is one
  payload         jsonb not null default '{}'::jsonb,
  recorded_at     timestamptz not null default now()
);

create index broker_kyb_events_by_broker on broker_kyb_events (broker_id, sequence_number);

create trigger broker_kyb_events_are_append_only
  before update or delete on broker_kyb_events
  for each row execute function forbid_change_of_financial_record();

create trigger broker_kyb_events_recorded_at_is_server_set
  before insert on broker_kyb_events
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- State premium tax rates: effective-dated, sourced, append-only
-- ---------------------------------------------------------------------------

-- The rate that applies to a policy is the row for its state with the greatest
-- effective_from that is not after the policy effective date. A rate change is a new row.
create table state_tax_rates (
  id                uuid primary key default gen_random_uuid(),
  state_code        text not null check (state_code ~ '^[A-Z]{2}$'),
  rate_bps          integer not null check (rate_bps >= 0 and rate_bps <= 10000),  -- 235 = 2.35%
  effective_from    date not null,
  source_url        text not null,                -- official page the rate was read from
  source_checked_on date not null,
  note              text,                         -- caveats, or 'ASSUMPTION, not verified'
  recorded_at       timestamptz not null default now(),
  unique (state_code, effective_from)
);

create trigger state_tax_rates_are_append_only
  before update or delete on state_tax_rates
  for each row execute function forbid_change_of_financial_record();

create trigger state_tax_rates_recorded_at_is_server_set
  before insert on state_tax_rates
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- Policies: identity only. The terms live in policy_events.
-- ---------------------------------------------------------------------------

create sequence policy_number_seq start with 1001;

create table policies (
  id            uuid primary key default gen_random_uuid(),
  policy_number text not null unique default ('CGP-' || lpad(nextval('policy_number_seq')::text, 5, '0')),
  broker_id     uuid not null references brokers (id),
  customer_id   uuid not null references customers (id),
  state_code    text not null check (state_code ~ '^[A-Z]{2}$'),  -- decides the premium tax rate
  created_by    text,                             -- user id of the broker who created the draft
  created_at    timestamptz not null default now()
);

create index policies_by_broker on policies (broker_id, created_at);

create trigger policies_are_append_only
  before update or delete on policies
  for each row execute function forbid_change_of_financial_record();

-- Every fact about a policy over time. The policy as of a date is the fold of the events
-- whose effective_at is not after that date; what was known on a date is the same fold
-- filtered on recorded_at instead.
--   'quoted'  : priced draft (annual premium, tax, fee, limits). No coverage, no journal entry.
--   'issued'  : the policy is bound. Written at collection time, once per policy.
--   later slices: 'endorsed', 'cancelled', 'correction_reversal', 'correction_rebook'.
create table policy_events (
  id                  uuid primary key default gen_random_uuid(),
  sequence_number     bigserial not null,         -- total order of recording
  policy_id           uuid not null references policies (id),
  event_type          text not null check (event_type in
                        ('quoted', 'issued', 'endorsed', 'cancelled', 'correction_reversal', 'correction_rebook')),
  effective_at        date not null,              -- business date the fact applies from
  recorded_at         timestamptz not null default now(),  -- booking time, set by the trigger below
  payload             jsonb not null,             -- amounts in integer cents, limits, calculation inputs
  supersedes_event_id uuid references policy_events (id),  -- set by corrections in slice B8
  created_by          text
);

create index policy_events_by_policy on policy_events (policy_id, sequence_number);

-- A policy is quoted once and bound once. A replayed webhook or a double-clicked form
-- hits one of these indexes instead of writing a second version of the same fact.
create unique index policy_events_one_quote_per_policy on policy_events (policy_id) where event_type = 'quoted';
create unique index policy_events_one_issuance_per_policy on policy_events (policy_id) where event_type = 'issued';

create trigger policy_events_are_append_only
  before update or delete on policy_events
  for each row execute function forbid_change_of_financial_record();

create trigger policy_events_recorded_at_is_server_set
  before insert on policy_events
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- Money operations: the immutable intent, and its append-only lifecycle
-- ---------------------------------------------------------------------------

-- One row per business intent to move money. Written and committed before the provider is
-- called (outbox rule, ARCHITECTURE.md section 4). The idempotency key is derived from the
-- intent, so a retry reuses the same key and the provider returns the original object
-- instead of charging twice.
create table money_operations (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('stripe_checkout', 'stripe_refund', 'claim_payout')),
  provider        text not null check (provider in ('stripe', 'simulator')),
  amount_cents    bigint not null check (amount_cents > 0),
  currency        text not null default 'usd' check (currency = 'usd'),  -- USD only in this trial
  policy_id       uuid references policies (id),
  idempotency_key text not null unique,
  created_by      text,
  created_at      timestamptz not null default now()  -- set by the trigger below
);

create index money_operations_by_policy on money_operations (policy_id, created_at);

create trigger money_operations_are_append_only
  before update or delete on money_operations
  for each row execute function forbid_change_of_financial_record();

create trigger money_operations_created_at_is_server_set
  before insert on money_operations
  for each row execute function set_created_at_from_database_clock();

-- What the provider said, in order. The current status of an operation is the status of its
-- last event by sequence_number. Nothing is ever updated: a failure after a success is a new
-- row, and both stay readable.
create table money_operation_events (
  id              uuid primary key default gen_random_uuid(),
  sequence_number bigserial not null,
  operation_id    uuid not null references money_operations (id),
  status          text not null check (status in
                    ('requested', 'provider_accepted', 'succeeded', 'failed', 'returned', 'unknown')),
  provider_ref    text,                           -- Stripe session id, payment intent id, refund id
  payload         jsonb not null default '{}'::jsonb,
  recorded_at     timestamptz not null default now()
);

create index money_operation_events_by_operation on money_operation_events (operation_id, sequence_number);

create trigger money_operation_events_are_append_only
  before update or delete on money_operation_events
  for each row execute function forbid_change_of_financial_record();

create trigger money_operation_events_recorded_at_is_server_set
  before insert on money_operation_events
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- policy_current: a cache, not a money record
-- ---------------------------------------------------------------------------

-- Rebuildable at any time from policy_events and money_operation_events
-- (lib/policy/current.ts, scripts/rebuild-policy-current.ts). It exists so a list page does
-- not fold every event of every policy. No balance and no amount is ever read from here to
-- post an entry; the ledger and the events remain the truth.
create table policy_current (
  policy_id                  uuid primary key references policies (id),
  status                     text not null check (status in
                               ('draft', 'awaiting_payment', 'payment_failed', 'bound', 'cancelled')),
  effective_at               date not null,       -- term start
  term_end                   date not null,
  annual_premium_cents       bigint not null,
  tax_rate_bps               integer not null,
  tax_cents                  bigint not null,
  fee_cents                  bigint not null,
  total_charge_cents         bigint not null,
  per_occurrence_limit_cents bigint not null,
  aggregate_limit_cents      bigint not null,
  bound_at                   timestamptz,         -- recording time of the 'issued' event
  rebuilt_at                 timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Grants: the runtime role can read, and insert only where the application must
-- ---------------------------------------------------------------------------

grant select, insert on policies, policy_events, money_operations, money_operation_events, customers to app_runtime;
grant select on brokers, users, state_tax_rates to app_runtime;
-- Slice B3 appends provider events from the Stripe Connect webhook; the table is append-only
-- for every role, so the INSERT right cannot become a way to rewrite a status.
grant select, insert on broker_kyb_events to app_runtime;
-- The cache is the only table the application may update, and it holds no money truth.
grant select, insert, update on policy_current to app_runtime;

grant usage, select on sequence policy_number_seq to app_runtime;
grant usage, select on sequence policy_events_sequence_number_seq to app_runtime;
grant usage, select on sequence money_operation_events_sequence_number_seq to app_runtime;
grant usage, select on sequence broker_kyb_events_sequence_number_seq to app_runtime;
