-- 0008: claims, reserves, the simulated payout rail, and maker-checker (slice B7).
-- Strictly additive: it creates new objects and adds two nullable columns. Nothing from 0001 to
-- 0006 is dropped or altered.
--
-- Six new protected financial records (AF-03), each with the same three guards as every table
-- of 0001 to 0005, and app_runtime receiving SELECT and INSERT only:
--
--   claims                     the loss: which policy, when it happened, who claims
--   claim_events               everything that ever happens to a claim, append-only
--   claimant_bank_accounts     where a claim payment would go, last4 and a token only
--   approval_requests          money-out waiting for a second human (maker-checker)
--   approval_decisions         that human's answer, one per request, guarded by a trigger
--   simulator_provider_records what the simulated bank believes, kept apart from our ledger
--
-- No mutable table is added: a claim's reserve, what it has paid and whether it is closed are
-- all folded from claim_events (lib/claims/money-position.ts). Nothing about a claim is stored
-- as a second truth, so nothing about a claim can drift from the journal.

-- ---------------------------------------------------------------------------
-- claims: the loss, and nothing else
-- ---------------------------------------------------------------------------

create sequence claim_number_seq start with 1;

-- Protected because occurred_at decides whether the loss is inside the covered period, which
-- decides whether any money may be paid at all. A wrong claim is closed and re-opened, never
-- edited.
create table claims (
  id            uuid primary key default gen_random_uuid(),
  claim_number  text not null unique default ('CLM-' || lpad(nextval('claim_number_seq')::text, 5, '0')),
  policy_id     uuid not null references policies (id),
  occurred_at   date not null,                   -- the day the loss happened (business date)
  reported_at   date not null,                   -- the day it was reported to us
  description   text not null,
  claimant_name text not null,                   -- who is claiming; the bank account must match it
  created_by    text,                            -- user id of the staff member who opened it
  recorded_at   timestamptz not null default now(),  -- overwritten by the trigger below
  -- A loss cannot be reported before it happened. The rest of the coverage rule (the loss must
  -- fall inside the covered period) needs the policy fold, so it lives in lib/claims/coverage.ts.
  check (reported_at >= occurred_at)
);

create index claims_by_policy on claims (policy_id, recorded_at);

create trigger claims_are_append_only
  before update or delete on claims
  for each row execute function forbid_change_of_financial_record();
create trigger claims_cannot_be_truncated
  before truncate on claims
  for each statement execute function forbid_truncate_of_financial_record();
create trigger claims_recorded_at_is_server_set
  before insert on claims
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- claim_events: the only truth about a claim's money
-- ---------------------------------------------------------------------------

-- WHAT amount_cents MEANS, per event type. This is the one thing to read before anything else
-- in this slice, because the whole fold in lib/claims/money-position.ts depends on it:
--
--   reserve_set        the reserve established for this claim          (must be > 0)
--   reserve_adjusted   the NEW OUTSTANDING reserve, not the change     (may be 0)
--   payment_requested  the amount a staff member asked to pay          (> 0)
--   payment_sent       the amount that left the reserve for the rail   (> 0)
--   payment_settled    the amount the rail says has settled            (> 0)
--   payment_returned   the amount the rail sent back                   (> 0)
--   closed             no amount at all                                (null)
--
-- "Outstanding reserve" is what is still expected to be paid: setting it to $4,000 after
-- $1,200 has already been paid means $1,200 paid plus $4,000 still expected, so incurred
-- becomes $5,200. The delta between the old and the new outstanding reserve is what the
-- journal entry books against incurred_loss_expense.
create table claim_events (
  id                uuid primary key default gen_random_uuid(),
  sequence_number   bigserial not null,          -- total order of recording, ties impossible
  claim_id          uuid not null references claims (id),
  event_type        text not null check (event_type in
                      ('reserve_set', 'reserve_adjusted', 'payment_requested', 'payment_sent',
                       'payment_settled', 'payment_returned', 'closed')),
  amount_cents      bigint,
  -- The payment this event is about. Null on reserve events and on 'closed'.
  money_operation_id uuid references money_operations (id),
  payload           jsonb not null default '{}'::jsonb,
  created_by        text,                        -- user id, null when a job caused the event
  recorded_at       timestamptz not null default now(),  -- overwritten by the trigger below

  -- The amount rule above, expressed at the database boundary.
  check (
    case event_type
      when 'closed'           then amount_cents is null
      when 'reserve_adjusted' then amount_cents >= 0
      else amount_cents > 0
    end
  ),
  -- A payment event names its money operation; a reserve event never does.
  check (
    (event_type in ('payment_requested', 'payment_sent', 'payment_settled', 'payment_returned'))
    = (money_operation_id is not null)
  )
);

create index claim_events_by_claim on claim_events (claim_id, sequence_number);

-- One payment moves through each stage at most once. Two concurrent "send" clicks, a replayed
-- job run or a double-submitted form hit this index inside the posting transaction and one of
-- them rolls back completely: at most one financial effect per payment and per stage.
create unique index claim_events_one_stage_per_payment
  on claim_events (money_operation_id, event_type) where money_operation_id is not null;

create trigger claim_events_are_append_only
  before update or delete on claim_events
  for each row execute function forbid_change_of_financial_record();
create trigger claim_events_cannot_be_truncated
  before truncate on claim_events
  for each statement execute function forbid_truncate_of_financial_record();
create trigger claim_events_recorded_at_is_server_set
  before insert on claim_events
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- claimant_bank_accounts: last4 and a token, never a bank account number
-- ---------------------------------------------------------------------------

-- AGENTS.md, KYC section: "Store only required data. Do not put ... bank details ... in logs,
-- fixtures, Git or screenshots." The routing and account numbers a staff member types are used
-- once, by lib/rails/bank-verification-simulator.ts, and never stored: what lands here is the
-- last four digits of each (enough for a human to recognise the account) and account_token, a
-- digest that stands in for the account everywhere else in the system.
--
-- Append-only, so a re-verification or a change of account is a NEW row and the latest row for
-- the claim wins. That is also what makes an approved payment refuse to go out to a bank
-- account that was swapped after the approval: the token is part of the approved intent.
create table claimant_bank_accounts (
  id                   uuid primary key default gen_random_uuid(),
  sequence_number      bigserial not null,
  claim_id             uuid not null references claims (id),
  account_holder_name  text not null,
  routing_number_last4 text not null check (routing_number_last4 ~ '^[0-9]{4}$'),
  account_number_last4 text not null check (account_number_last4 ~ '^[0-9]{4}$'),
  account_token        text not null,            -- 'sim_ba_<32 hex>', see the simulator module
  verification_status  text not null check (verification_status in ('unknown', 'verified', 'failed')),
  provider             text not null check (provider = 'simulator'),  -- LOCAL SIMULATOR, never a live bank
  payload              jsonb not null default '{}'::jsonb,  -- why the check passed or failed
  recorded_at          timestamptz not null default now()
);

create index claimant_bank_accounts_by_claim on claimant_bank_accounts (claim_id, sequence_number);

create trigger claimant_bank_accounts_are_append_only
  before update or delete on claimant_bank_accounts
  for each row execute function forbid_change_of_financial_record();
create trigger claimant_bank_accounts_cannot_be_truncated
  before truncate on claimant_bank_accounts
  for each statement execute function forbid_truncate_of_financial_record();
create trigger claimant_bank_accounts_recorded_at_is_server_set
  before insert on claimant_bank_accounts
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- approval_requests: money-out waiting for a second human
-- ---------------------------------------------------------------------------

-- Written BEFORE any provider or simulator call, inside the transaction that creates the money
-- operation, so there is no instant at which money could leave without its request on disk.
--
-- intent_hash is the sha256 of the canonical intent (kind, subject kind, subject id, amount,
-- destination) computed by lib/approvals/intent.ts. At execution the intent is rebuilt from the
-- CURRENT state of the world and hashed again: if anything an approver was shown has changed
-- since, the hashes differ and the execution is refused. A changed intent needs a new request.
--
-- subject_id has no foreign key on purpose: it names a claim or a policy depending on
-- subject_kind, and one column cannot reference two tables. The reads that use it always join
-- on the matching table for the kind they asked for (lib/approvals/read.ts).
create table approval_requests (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('claim_payment', 'refund')),
  subject_kind text not null check (subject_kind in ('claim', 'policy')),
  subject_id   uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  intent_hash  text not null check (intent_hash ~ '^[0-9a-f]{64}$'),
  -- Where the money would go, in words, so the approver decides on something readable rather
  -- than on a hash: 'simulated bank account ...1234' or 'Stripe payment pi_...'.
  destination  text not null,
  -- A real user id with a real foreign key: who asked is the whole point of maker-checker.
  requested_by uuid not null references users (id),
  payload      jsonb not null default '{}'::jsonb,
  recorded_at  timestamptz not null default now()
);

create index approval_requests_by_subject on approval_requests (subject_kind, subject_id, recorded_at);

create trigger approval_requests_are_append_only
  before update or delete on approval_requests
  for each row execute function forbid_change_of_financial_record();
create trigger approval_requests_cannot_be_truncated
  before truncate on approval_requests
  for each statement execute function forbid_truncate_of_financial_record();
create trigger approval_requests_recorded_at_is_server_set
  before insert on approval_requests
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- approval_decisions: one answer per request, and the database decides who may give it
-- ---------------------------------------------------------------------------

create table approval_decisions (
  id          uuid primary key default gen_random_uuid(),
  -- One decision per request, forever. A rejected request is not re-decided: the maker starts
  -- a new request, which is a new intent that a checker sees fresh.
  request_id  uuid not null unique references approval_requests (id),
  decided_by  uuid not null references users (id),
  decision    text not null check (decision in ('approved', 'rejected')),
  reason      text,
  recorded_at timestamptz not null default now()
);

create trigger approval_decisions_are_append_only
  before update or delete on approval_decisions
  for each row execute function forbid_change_of_financial_record();
create trigger approval_decisions_cannot_be_truncated
  before truncate on approval_decisions
  for each statement execute function forbid_truncate_of_financial_record();
create trigger approval_decisions_recorded_at_is_server_set
  before insert on approval_decisions
  for each row execute function set_recorded_at_from_database_clock();

-- The maker-checker rule itself, as a database fact rather than only as application code
-- (general non-negotiable 6, design finding F-10). Three refusals, in the order a reader would
-- ask them:
--
--   1. the decider must be the same person who asked  -> refused: that is self-approval;
--   2. the decider must exist as a user;
--   3. the decider's role must be exactly 'staff_approver'.
--
-- Rule 3 is also how an AGENT can never approve. Slice B11 creates a user per MCP API key with
-- the role 'agent'; because this trigger demands exactly 'staff_approver', such a principal is
-- refused here, by the database, whatever route it came through and whatever the application
-- code does. staff_ops (the maker role) is refused for the same reason.
create or replace function enforce_maker_checker_on_approval_decision() returns trigger
language plpgsql as $$
declare
  requester_user_id uuid;
  decider_role      text;
begin
  select requested_by into requester_user_id from approval_requests where id = new.request_id;
  if requester_user_id is null then
    raise exception 'approval request % does not exist', new.request_id
      using errcode = 'foreign_key_violation';
  end if;

  if new.decided_by = requester_user_id then
    raise exception 'maker-checker: the person who requested this money-out cannot approve it (request %)', new.request_id
      using errcode = 'insufficient_privilege';
  end if;

  select role into decider_role from users where id = new.decided_by;
  if decider_role is null then
    raise exception 'maker-checker: user % does not exist, so it cannot decide request %', new.decided_by, new.request_id
      using errcode = 'insufficient_privilege';
  end if;
  if decider_role <> 'staff_approver' then
    raise exception 'maker-checker: only a staff_approver may decide a money-out request; user % has the role %', new.decided_by, decider_role
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger approval_decisions_enforce_maker_checker
  before insert on approval_decisions
  for each row execute function enforce_maker_checker_on_approval_decision();

-- ---------------------------------------------------------------------------
-- simulator_provider_records: what the simulated bank believes
-- ---------------------------------------------------------------------------

-- LOCAL SIMULATOR. This table is the provider's side of the claim payout rail, not ours. It is
-- written by exactly one module, lib/rails/simulator.ts, and by nothing else, and it holds no
-- foreign key into our money tables on purpose: the only thing linking the two worlds is
-- transfer_ref, which we store on the money operation as its provider_ref, exactly as a Stripe
-- refund id is stored (design finding F-03, ARCHITECTURE.md section 4).
--
-- That separation is what makes the reconciliation of slice B10 a real diff: a mismatch can be
-- planted here, on the provider side, without touching a single journal entry, and the job has
-- to find it by comparing two independent records of the same transfer.
--
-- Append-only like everything else, so a transfer moving from sent to settled to returned is
-- three rows, not one row updated three times. unique (transfer_ref, status) is what makes a
-- replayed settlement job a no-op.
create table simulator_provider_records (
  id                uuid primary key default gen_random_uuid(),
  sequence_number   bigserial not null,
  transfer_ref      text not null,               -- 'sim_tr_<32 hex>', the rail's own reference
  amount_cents      bigint not null check (amount_cents > 0),
  destination_token text not null,               -- the claimant_bank_accounts token it was sent to
  status            text not null check (status in ('sent', 'settled', 'returned')),
  -- For 'sent': the day the rail expects to settle (two business-agnostic days later in this
  -- simulator). For 'settled' and 'returned': the day it actually happened.
  settlement_date   date not null,
  payload           jsonb not null default '{}'::jsonb,
  recorded_at       timestamptz not null default now(),
  unique (transfer_ref, status)
);

create index simulator_provider_records_by_transfer on simulator_provider_records (transfer_ref, sequence_number);
create index simulator_provider_records_due on simulator_provider_records (status, settlement_date);

create trigger simulator_provider_records_are_append_only
  before update or delete on simulator_provider_records
  for each row execute function forbid_change_of_financial_record();
create trigger simulator_provider_records_cannot_be_truncated
  before truncate on simulator_provider_records
  for each statement execute function forbid_truncate_of_financial_record();
create trigger simulator_provider_records_recorded_at_is_server_set
  before insert on simulator_provider_records
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- Two columns on money_operations, both already named by ARCHITECTURE.md section 4
-- ---------------------------------------------------------------------------

-- Adding a nullable column is additive: no existing row changes, no existing statement breaks,
-- and the append-only trigger is untouched (it refuses row changes, not schema changes).
alter table money_operations add column claim_id uuid references claims (id);

-- The approval that lets this operation move money. Set at INSERT time, in the same transaction
-- as the approval request, because money_operations can never be updated afterwards.
alter table money_operations add column approval_request_id uuid references approval_requests (id);

-- One approval, one money operation, forever. This is the "at most one financial effect"
-- guarantee for concurrent executions written as a database fact: whatever races to spend an
-- approval, only one operation can carry it.
create unique index money_operations_one_per_approval_request
  on money_operations (approval_request_id) where approval_request_id is not null;

create index money_operations_by_claim on money_operations (claim_id, created_at);

-- ---------------------------------------------------------------------------
-- Grants: read and append, and nothing else, on every new table
-- ---------------------------------------------------------------------------

grant select, insert on
  claims, claim_events, claimant_bank_accounts,
  approval_requests, approval_decisions, simulator_provider_records
  to app_runtime;

grant usage, select on sequence claim_number_seq to app_runtime;
grant usage, select on sequence claim_events_sequence_number_seq to app_runtime;
grant usage, select on sequence claimant_bank_accounts_sequence_number_seq to app_runtime;
grant usage, select on sequence simulator_provider_records_sequence_number_seq to app_runtime;
