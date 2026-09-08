-- 0005: cancellations and refunds (slice B5).
-- Strictly additive: it creates new objects only. Nothing from 0001 to 0004 is dropped or altered.
--
-- Almost everything a cancellation needs already exists:
--   * the policy_events check constraint (0002) already allows event_type 'cancelled';
--   * money_operations.kind (0002) already allows 'stripe_refund';
--   * money_operation_events.status (0002) already allows 'requested', 'provider_accepted',
--     'succeeded' and 'failed';
--   * the accounts refund_payable, unearned_premium, earned_premium, premium_tax_payable,
--     commission_payable and commission_expense are all seeded by 0001.
--
-- This migration adds the two things that were missing:
--   1. refund_allocations, which says WHICH Stripe payment each refund operation gives back
--      and how that amount splits into premium, tax and commission clawback;
--   2. a partial unique index making "a policy is cancelled at most once" a database fact.

-- ---------------------------------------------------------------------------
-- refund_allocations: one row per Stripe refund we ask for
-- ---------------------------------------------------------------------------

-- A refund is created against one PaymentIntent, so a policy paid in several instalments
-- (issuance now, endorsement later in slice B4) needs several Stripe refunds for one
-- cancellation: one money_operations row and one row here per PaymentIntent touched.
-- The allocation rule itself (newest collection first) lives in
-- lib/money/refund-allocation.ts; this table stores what that rule decided, so the amounts
-- are read back rather than recomputed when the provider answers.
--
-- Protected financial record (AF-03): the three guards below, and app_runtime gets SELECT and
-- INSERT only. A refund that turns out wrong is corrected by a new operation, never by an
-- UPDATE of this row.
create table refund_allocations (
  id                        uuid primary key default gen_random_uuid(),
  -- The money operation that carries this refund. One operation, one Stripe refund, so the
  -- unique constraint here is the same statement as "one refund per operation".
  refund_operation_id       uuid not null unique references money_operations (id),
  policy_id                 uuid not null references policies (id),
  -- The policy event that decided the refund: the 'cancelled' event today, an 'endorsed'
  -- event with a negative premium delta in slice B4.
  policy_event_id           uuid not null references policy_events (id),
  -- The collection being given back, and the Stripe PaymentIntent it was collected on.
  -- The PaymentIntent is stored explicitly because it is what the Refunds API needs, and
  -- what an incoming refund webhook is matched on when its metadata is missing.
  collection_operation_id   uuid not null references money_operations (id),
  payment_intent_id         text not null,
  -- What Stripe is asked to send back, and its three business components. The components are
  -- decided once, at cancellation time, and posted to the journal unchanged when the refund
  -- completes: preview, execution and ledger therefore always show the same figures.
  amount_cents              bigint not null check (amount_cents > 0),
  refunded_premium_cents    bigint not null check (refunded_premium_cents >= 0),
  refunded_tax_cents        bigint not null check (refunded_tax_cents >= 0),
  commission_clawback_cents bigint not null check (commission_clawback_cents >= 0),
  recorded_at               timestamptz not null default now(),  -- overwritten by the trigger below
  -- The fee is never refunded (Yoann's decision, DECISIONS.md), so a refund is exactly
  -- premium plus the tax on that premium. The database refuses any other split.
  check (amount_cents = refunded_premium_cents + refunded_tax_cents)
);

create index refund_allocations_by_payment_intent on refund_allocations (payment_intent_id);
create index refund_allocations_by_policy on refund_allocations (policy_id, recorded_at);

-- Guard 1: no UPDATE, no DELETE, for every role including the owner (function from 0001).
create trigger refund_allocations_are_append_only
  before update or delete on refund_allocations
  for each row execute function forbid_change_of_financial_record();

-- Guard 2: no TRUNCATE either (function from 0003 and 0004).
create trigger refund_allocations_cannot_be_truncated
  before truncate on refund_allocations
  for each statement execute function forbid_truncate_of_financial_record();

-- Guard 3: the recording time comes from the database clock, never from the client.
create trigger refund_allocations_recorded_at_is_server_set
  before insert on refund_allocations
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- A policy is cancelled at most once
-- ---------------------------------------------------------------------------

-- Same shape as the 'quoted' and 'issued' indexes of 0002. Two people cancelling the same
-- policy at the same moment, or a double-clicked confirmation, hit this index inside the
-- posting transaction and one of them rolls back completely.
-- Slice B8 corrects a wrong cancellation date with 'correction_reversal' and
-- 'correction_rebook' events, not with a second 'cancelled' event, so this index does not
-- stand in the way of a correction.
create unique index policy_events_one_cancellation_per_policy
  on policy_events (policy_id) where event_type = 'cancelled';

-- ---------------------------------------------------------------------------
-- Grants: read and append, nothing else
-- ---------------------------------------------------------------------------

grant select, insert on refund_allocations to app_runtime;
