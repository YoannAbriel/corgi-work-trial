-- 0006: broker KYB wiring (slice B3).
-- Strictly additive: it creates one table, adds one nullable column and one index. Nothing
-- from 0001 to 0005 is dropped or altered.
--
-- What was already there, and is reused unchanged:
--   * broker_kyb_events (0002) holds one append-only row per status observed for a broker:
--     provider, status, provider_ref (the connected account id) and payload. Slice B3 fills it
--     with real Stripe Connect statuses instead of the seed placeholder.
--   * brokers is append-only, so a broker row can never learn its connected account id by
--     UPDATE. It does not need to: the account id lives on the events, exactly as a Stripe
--     payment reference lives on money_operation_events and never on money_operations.
--
-- What this migration adds:
--   1. broker_kyb_submissions: what the broker actually declared and accepted, written and
--      committed BEFORE Stripe is called, so a crash during the provider call cannot lose the
--      terms acceptance we are legally passing on to Stripe.
--   2. broker_kyb_events.created_by: which human caused a status row, for the staff re-read
--      action. Null for rows written by a webhook, like every other created_by in this schema.

-- ---------------------------------------------------------------------------
-- broker_kyb_submissions: the immutable intent behind one verification
-- ---------------------------------------------------------------------------

-- Protected financial record (AF-03) in the same sense as `brokers`: it carries facts that
-- decide whether money may be bound (the legal identity submitted for verification) and the
-- terms acceptance Stripe requires. Three guards, like every protected table:
--   1. a BEFORE UPDATE OR DELETE trigger that raises for every role, owner included;
--   2. a BEFORE TRUNCATE trigger;
--   3. recorded_at set from the database clock, never from the client.
-- app_runtime receives SELECT and INSERT only. A submission that was wrong is corrected by
-- submitting again, which creates a new row and a new Stripe account; nothing is edited.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- The EIN. Only its last four digits are stored: the full number is sent to Stripe, which is
-- the party that verifies it, and is never written to our database, our logs or our fixtures
-- (AGENTS.md, KYC section: store only required data). Four digits are enough for an operator
-- to recognise which number was used and not enough to be the number.
--
-- The connected account id. Stripe mints it, so it does not exist when this row is committed,
-- and the row can never be updated afterwards. The account id is appended to
-- broker_kyb_events.provider_ref as soon as Stripe answers, which is the same shape the money
-- tables already use (intent first, provider reference on the events). What this row carries
-- instead is the idempotency key the provider call will use: it is known before the call, it
-- is unique, and it turns a double-sent request into one Stripe account. (It does not replay
-- a lost answer: the EIN is not stored, so a later resubmission uses a new key.)
create table broker_kyb_submissions (
  id                  uuid primary key default gen_random_uuid(),
  sequence_number     bigserial not null,          -- total order of recording, ties impossible
  broker_id           uuid not null references brokers (id),
  provider            text not null,               -- 'stripe_connect'
  -- Derived from the broker id and the attempt number (lib/broker/kyb-onboarding.ts), never
  -- random: the unique index below turns a double-clicked form into one submission instead
  -- of two Stripe accounts. A resubmission after a lost answer is a new attempt, new key.
  provider_idempotency_key text not null unique,
  -- What the broker declared. These are the values sent to Stripe for verification.
  legal_name          text not null,
  ein_last4           text not null check (ein_last4 ~ '^[0-9]{4}$'),
  address_line1       text not null,               -- accepts Stripe's test token 'address_full_match'
  address_city        text not null,
  address_state       text not null check (address_state ~ '^[A-Z]{2}$'),
  address_postal_code text not null,
  business_url        text not null,               -- Stripe rejects an account created without one
  contact_email       text not null,
  -- The Stripe Connected Account Agreement, accepted in our own interface because an account
  -- with no Stripe dashboard cannot accept it on Stripe's side. The instant and the address
  -- are the real ones read from the request; they are passed to Stripe verbatim.
  terms_accepted_at   timestamptz not null,
  terms_accepted_ip   text not null,
  submitted_by        text,                        -- user id of the human who submitted
  recorded_at         timestamptz not null default now()  -- overwritten by the trigger below
);

create index broker_kyb_submissions_by_broker on broker_kyb_submissions (broker_id, sequence_number);

-- Guard 1: no UPDATE, no DELETE, for every role including the owner (function from 0001).
create trigger broker_kyb_submissions_are_append_only
  before update or delete on broker_kyb_submissions
  for each row execute function forbid_change_of_financial_record();

-- Guard 2: no TRUNCATE either (function from 0003 and 0004).
create trigger broker_kyb_submissions_cannot_be_truncated
  before truncate on broker_kyb_submissions
  for each statement execute function forbid_truncate_of_financial_record();

-- Guard 3: the recording time comes from the database clock, never from the client.
create trigger broker_kyb_submissions_recorded_at_is_server_set
  before insert on broker_kyb_submissions
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- broker_kyb_events: who caused a status row
-- ---------------------------------------------------------------------------

-- ADD COLUMN on a protected table is additive: it writes no row and changes no existing value,
-- so the append-only guarantee is untouched. It is the same shape as created_by on
-- journal_entries, policy_events and money_operations: the user id when a human caused the
-- row, null when a provider event did.
alter table broker_kyb_events add column created_by text;

-- ---------------------------------------------------------------------------
-- Grants: read and append, nothing else
-- ---------------------------------------------------------------------------

-- broker_kyb_events already had SELECT and INSERT for app_runtime (0002); a table-level INSERT
-- covers the new column, so nothing has to be re-granted there.
grant select, insert on broker_kyb_submissions to app_runtime;
grant usage, select on sequence broker_kyb_submissions_sequence_number_seq to app_runtime;
