-- 0014: correcting the effective date of an applied endorsement (slice B8).
-- Numbered 0014 because 0012 (statements) and 0013 (hardening) are built in parallel. This file
-- touches objects none of them touch, so the three apply in any order.
--
-- What already exists and is reused unchanged:
--   * policy_events (0002) already allows 'correction_reversal' and 'correction_rebook';
--   * journal_entries.reverses_entry_id (0001) is UNIQUE, which is what makes "an entry is
--     reversed at most once" a database fact, and therefore "an endorsement is corrected at most
--     once" too;
--   * money_operations.kind (0002) already allows 'stripe_checkout' (the difference to collect)
--     and 'stripe_refund' (the difference to give back);
--   * refund_allocations (0005) already records what a Stripe refund gives back and which policy
--     event decided it: a correction points it at the re-book event;
--   * every account the correction entries use is seeded by 0001.
--
-- What this migration adds:
--   1. one more policy event type, 'correction_approved' (the customer accepting to pay the
--      difference a correction created, above $500, exactly like an endorsement above $500);
--   2. correction_collections: which Stripe payment collects the difference of which correction,
--      and the split of that amount into premium and tax, decided once at checkout time;
--   3. two partial unique indexes: one re-book per corrected event, one approval per re-book.

-- ---------------------------------------------------------------------------
-- 1. One more policy event type
-- ---------------------------------------------------------------------------

-- Replacing a CHECK constraint writes no row and changes no value, so the append-only guarantee
-- of policy_events is untouched: the same rows are there, the same rows stay immutable, and one
-- more value is accepted on future inserts. The list is the eight values of 0009 plus the one
-- added here.
alter table policy_events drop constraint policy_events_event_type_check;

alter table policy_events
  add constraint policy_events_event_type_check
  check (event_type in (
    'quoted',
    'issued',
    'endorsement_requested',
    'endorsement_approved',
    'endorsed',
    'cancelled',
    'correction_reversal',    -- undoes an event recorded with a wrong fact; carries the reason
    'correction_rebook',      -- the same change, re-booked with the corrected fact
    'correction_approved'     -- the customer accepted to pay the difference a correction created
  ));

-- ---------------------------------------------------------------------------
-- 2. correction_collections: one row per Stripe payment that collects a difference
-- ---------------------------------------------------------------------------

-- A correction that moves an endorsement to an EARLIER date charges more days of cover, so the
-- customer owes the difference. That difference is collected by an ordinary 'stripe_checkout'
-- money operation (same outbox, same webhook events, same expiry handling as every other
-- payment); this row is what says "that payment settles the difference of THIS correction", the
-- same way endorsement_collections (0009) says which endorsement a delta payment pays for.
--
-- Protected financial record (AF-03): the three guards below, and app_runtime gets SELECT and
-- INSERT only. A payment attempt that dies (expired hosted page) is a new operation and a new
-- row here, never an UPDATE of this one.
create table correction_collections (
  id                        uuid primary key default gen_random_uuid(),
  -- One operation settles one correction: unique here is the same statement as "an operation
  -- cannot be the difference of two corrections".
  collection_operation_id   uuid not null unique references money_operations (id),
  policy_id                 uuid not null references policies (id),
  -- The 'correction_rebook' event whose difference this payment collects.
  correction_rebook_event_id uuid not null references policy_events (id),
  -- What Stripe is asked to collect, and its two business components. Decided when the
  -- correction is recorded and posted unchanged when the payment succeeds.
  amount_cents              bigint not null check (amount_cents > 0),
  premium_cents             bigint not null check (premium_cents > 0),
  tax_cents                 bigint not null check (tax_cents >= 0),
  recorded_at               timestamptz not null default now(),  -- overwritten by the trigger below
  -- The flat fee is charged at issuance only (DECISIONS.md), so a difference is exactly premium
  -- plus the tax on that premium. The database refuses any other split.
  check (amount_cents = premium_cents + tax_cents)
);

create index correction_collections_by_rebook on correction_collections (correction_rebook_event_id, recorded_at);
create index correction_collections_by_policy on correction_collections (policy_id, recorded_at);

-- Guard 1: no UPDATE, no DELETE, for every role including the owner (function from 0001).
create trigger correction_collections_are_append_only
  before update or delete on correction_collections
  for each row execute function forbid_change_of_financial_record();

-- Guard 2: no TRUNCATE either (function from 0003).
create trigger correction_collections_cannot_be_truncated
  before truncate on correction_collections
  for each statement execute function forbid_truncate_of_financial_record();

-- Guard 3: the recording time comes from the database clock, never from the client.
create trigger correction_collections_recorded_at_is_server_set
  before insert on correction_collections
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- 3. One re-book per corrected event, one approval per re-book
-- ---------------------------------------------------------------------------

-- Same shape as the 'quoted', 'issued' and 'endorsed' indexes. `corrects_event_id` is the id of
-- the event whose effective date was wrong; a second correction of the same event is refused
-- inside its transaction, whatever code path asked for it. Correcting a correction is still
-- allowed, because it names the RE-BOOK as the event it corrects, which is a different id.
create unique index policy_events_one_rebook_per_corrected_event
  on policy_events ((payload ->> 'corrects_event_id'))
  where event_type = 'correction_rebook';

create unique index policy_events_one_approval_per_correction
  on policy_events ((payload ->> 'correction_rebook_event_id'))
  where event_type = 'correction_approved';

-- ---------------------------------------------------------------------------
-- Grants: read and append, nothing else
-- ---------------------------------------------------------------------------

grant select, insert on correction_collections to app_runtime;
