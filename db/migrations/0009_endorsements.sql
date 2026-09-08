-- 0009: endorsements (slice B4).
-- Numbered 0009 because 0008 belongs to slice B7 (claims and approvals), built in parallel.
-- The two files touch disjoint objects and apply in any order: 0008 creates its own tables
-- and adds two nullable columns to money_operations; this file never reads them.
--
-- What already exists and is reused unchanged:
--   * policy_events (0002) already allows event_type 'endorsed', which is the applied change;
--   * money_operations.kind (0002) already allows 'stripe_checkout' (the delta collected through
--     a hosted Checkout Session) and 'stripe_refund' (a negative delta refunded at once);
--   * refund_allocations (0005) already records what a Stripe refund gives back and which policy
--     event decided it: an 'endorsed' event with a negative delta uses it exactly like a
--     cancellation does;
--   * every account the endorsement entries use is seeded by 0001.
--
-- What this migration adds:
--   1. two policy event types, 'endorsement_requested' (the quote, with its hash) and
--      'endorsement_approved' (the customer's approval of that hash), so that the whole life
--      of an endorsement is readable in policy_events like everything else about a policy;
--   2. endorsement_collections: which Stripe payment collects which endorsement's delta, and
--      the split of that amount into premium and tax, decided once at checkout time;
--   3. two partial unique indexes: one 'endorsed' and one 'endorsement_approved' per request.

-- ---------------------------------------------------------------------------
-- 1. Policy event types
-- ---------------------------------------------------------------------------

-- Replacing a CHECK constraint writes no row and changes no value, so the append-only guarantee
-- of policy_events is untouched: the same rows are there, the same rows stay immutable, and two
-- more values are accepted on future inserts. The list is the union of the six values of 0002
-- and the two added here. Slice B7 (0008) does not touch this constraint (confirmed with its
-- author on 2026-09-08), so the order of 0008 and 0009 does not matter.
alter table policy_events drop constraint policy_events_event_type_check;

alter table policy_events
  add constraint policy_events_event_type_check
  check (event_type in (
    'quoted',
    'issued',
    'endorsement_requested',   -- the quote: figures, quote hash, policy version, who asked
    'endorsement_approved',    -- the customer accepted that quote hash (needed above $500)
    'endorsed',                -- the change is in force: new terms plus the delta that moved
    'cancelled',
    'correction_reversal',
    'correction_rebook'
  ));

-- ---------------------------------------------------------------------------
-- 2. endorsement_collections: one row per Stripe payment that collects a positive delta
-- ---------------------------------------------------------------------------

-- The money operation itself is an ordinary 'stripe_checkout' row (same outbox, same webhook
-- events, same expiry handling as the issuance payment). This row is what says "that payment
-- is the delta of THIS endorsement request", the same way refund_allocations says which policy
-- event a refund gives back. Every query that means "the issuance payment of a policy" excludes
-- operations that have a row here.
--
-- Protected financial record (AF-03): the three guards below, and app_runtime gets SELECT and
-- INSERT only. A payment attempt that dies (expired hosted page) is a new operation and a new
-- row here, never an UPDATE of this one.
create table endorsement_collections (
  id                      uuid primary key default gen_random_uuid(),
  -- One operation collects one endorsement: unique here is the same statement as
  -- "an operation cannot be the delta of two endorsements".
  collection_operation_id uuid not null unique references money_operations (id),
  policy_id               uuid not null references policies (id),
  -- The 'endorsement_requested' event whose delta this payment collects.
  request_event_id        uuid not null references policy_events (id),
  -- The quote the payment is bound to. Recomputed and compared at posting time, so a payment
  -- can never apply figures the customer did not approve.
  quote_hash              text not null,
  -- What Stripe is asked to collect, and its two business components. Decided at checkout time
  -- from the request event and posted unchanged when the payment succeeds.
  amount_cents            bigint not null check (amount_cents > 0),
  delta_premium_cents     bigint not null check (delta_premium_cents > 0),
  delta_tax_cents         bigint not null check (delta_tax_cents >= 0),
  recorded_at             timestamptz not null default now(),  -- overwritten by the trigger below
  -- The flat fee is charged at issuance only (DECISIONS.md), so a delta collection is exactly
  -- premium plus the tax on that premium. The database refuses any other split.
  check (amount_cents = delta_premium_cents + delta_tax_cents)
);

create index endorsement_collections_by_request on endorsement_collections (request_event_id, recorded_at);
create index endorsement_collections_by_policy on endorsement_collections (policy_id, recorded_at);

-- Guard 1: no UPDATE, no DELETE, for every role including the owner (function from 0001).
create trigger endorsement_collections_are_append_only
  before update or delete on endorsement_collections
  for each row execute function forbid_change_of_financial_record();

-- Guard 2: no TRUNCATE either (function from 0003 and 0004).
create trigger endorsement_collections_cannot_be_truncated
  before truncate on endorsement_collections
  for each statement execute function forbid_truncate_of_financial_record();

-- Guard 3: the recording time comes from the database clock, never from the client.
create trigger endorsement_collections_recorded_at_is_server_set
  before insert on endorsement_collections
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- 3. One application and one approval per endorsement request
-- ---------------------------------------------------------------------------

-- Same shape as the 'quoted', 'issued' and 'cancelled' indexes, keyed on the request event id
-- that the 'endorsed' and 'endorsement_approved' payloads carry. A replayed payment webhook or
-- a double-clicked approval hits one of these inside its transaction and rolls back entirely,
-- which is what makes "twice is once" a database fact rather than a code path.
create unique index policy_events_one_endorsement_per_request
  on policy_events ((payload ->> 'request_event_id'))
  where event_type = 'endorsed';

create unique index policy_events_one_approval_per_request
  on policy_events ((payload ->> 'request_event_id'))
  where event_type = 'endorsement_approved';

-- ---------------------------------------------------------------------------
-- Grants: read and append, nothing else
-- ---------------------------------------------------------------------------

grant select, insert on endorsement_collections to app_runtime;
