-- 0019: the customer's change requests on a policy (slice B13-6).
-- Strictly additive: it creates two tables and their guards. Nothing from 0001 to 0018 is
-- dropped, altered or redefined, and no existing column changes meaning.
--
-- What this slice adds to the system: the customer can now READ their own policy at
-- /policies/{id} (before, they were redirected to /customer), and ask for a change on it. A
-- request names the lines of the policy it is about, carries a comment, and is answered by the
-- owning broker or by staff operations with one reply. That is the whole feature.
--
-- WHAT IT IS NOT. A change request moves no money and changes no policy. It writes no
-- policy_event, posts no journal entry and touches no money table. When the broker agrees, the
-- change itself goes through the normal endorsement flow (slice B4), which prices it, collects
-- the delta and writes the events. A request is a message, and these two tables are its record.
-- Decided by Yoann on 2026-09-08 at 20:35 UTC (DECISIONS.md).
--
-- ---------------------------------------------------------------------------------------
-- Why these two tables are append-only like the money tables
-- ---------------------------------------------------------------------------------------
--
-- They hold no money, so AF-03 does not protect them by itself. They carry the same guards
-- anyway, for the reason mcp_calls and webhook_events do: they record what a customer asked and
-- what a broker answered. An UPDATE would let a broker rewrite a customer's complaint, or a
-- customer rewrite a request after the answer; a DELETE would make an unanswered request
-- disappear. So, exactly as in 0018:
--
--   1. a BEFORE UPDATE OR DELETE trigger that raises for every role, the owner included;
--   2. a BEFORE TRUNCATE trigger;
--   3. the recording time set from the database clock, never from the client;
--   4. app_runtime holds SELECT and INSERT and nothing else.
--
-- A REPLY IS A ROW, NOT A COLUMN, for the same reason a revocation is a row in 0018: a request
-- can never be edited, so "answered" cannot be a flag written into it later. It is read as "a
-- reply row exists for this request", and the reply carries who wrote it and when.

-- ---------------------------------------------------------------------------
-- 1. policy_change_requests: what the customer asked, and about which lines
-- ---------------------------------------------------------------------------

create table policy_change_requests (
  id           uuid primary key default gen_random_uuid(),
  policy_id    uuid not null references policies (id),
  -- The user who asked. The application checks that this user is the customer of this policy
  -- (lib/policy/change-requests.ts, createChangeRequest); the column records who it was.
  requested_by uuid not null references users (id),
  -- THE LINES OF THE POLICY THE REQUEST IS ABOUT, at least one. They are the labels the customer
  -- ticks on the policy page, not database column names: the request points at what the customer
  -- reads, and the broker decides what that means in the endorsement. The CHECK keeps the array
  -- inside the closed list, so a forged form cannot store anything else, and the screens can map
  -- every value to a label without a default case.
  lines        text[] not null
                 check (cardinality(lines) between 1 and 7)
                 check (lines <@ array['insured_name', 'mailing_address', 'per_occurrence_limit',
                                       'aggregate_limit', 'annual_premium', 'effective_date',
                                       'other']::text[]),
  -- What the customer wants, in their own words. Ten characters at least, so "change it" cannot
  -- be sent as a whole request; five hundred at most, because this is a message, not a document.
  -- The application trims before inserting, so the bounds are on real text, not on spaces.
  comment      text not null check (char_length(comment) between 10 and 500),
  recorded_at  timestamptz not null default now()   -- overwritten by the trigger below
);

-- The two reads this table has: every request of one policy (the policy page, both sides), and
-- the open ones of a broker (the what-needs-you count), which joins through policies.
create index policy_change_requests_by_policy on policy_change_requests (policy_id, recorded_at desc);

create trigger policy_change_requests_are_append_only
  before update or delete on policy_change_requests
  for each row execute function forbid_change_of_financial_record();

create trigger policy_change_requests_cannot_be_truncated
  before truncate on policy_change_requests
  for each statement execute function forbid_truncate_of_financial_record();

create trigger policy_change_requests_recorded_at_is_server_set
  before insert on policy_change_requests
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- 2. policy_change_request_replies: one answer per request, written once
-- ---------------------------------------------------------------------------

create table policy_change_request_replies (
  id          uuid primary key default gen_random_uuid(),
  -- UNIQUE: a request is answered once. A second reply is refused by the database, not by a
  -- check the application could forget, so two brokers pressing the button at the same moment
  -- produce one answer and one refusal (proven by scripts/check-change-requests.ts).
  request_id  uuid not null unique references policy_change_requests (id),
  -- The owning broker, or a staff operations user. Checked by the application
  -- (lib/policy/change-requests.ts, replyToChangeRequest); recorded here.
  replied_by  uuid not null references users (id),
  -- 'answered': the broker has replied and nothing more is planned for now.
  -- 'done':     the broker has acted on it, through the normal endorsement flow.
  -- Either way the request is no longer open: what makes it closed is the existence of this row,
  -- and the outcome only says which of the two happened.
  outcome     text not null check (outcome in ('answered', 'done')),
  -- The broker's answer, in their own words. One character at least (the application refuses an
  -- empty answer); five hundred at most, like the comment it answers. The floor is lower than
  -- the comment's ten because "Done." is a legitimate whole answer, while "change it" is not a
  -- legitimate whole request.
  reply_text  text not null check (char_length(reply_text) between 1 and 500),
  recorded_at timestamptz not null default now()   -- overwritten by the trigger below
);

create trigger policy_change_request_replies_are_append_only
  before update or delete on policy_change_request_replies
  for each row execute function forbid_change_of_financial_record();

create trigger policy_change_request_replies_cannot_be_truncated
  before truncate on policy_change_request_replies
  for each statement execute function forbid_truncate_of_financial_record();

create trigger policy_change_request_replies_recorded_at_is_server_set
  before insert on policy_change_request_replies
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- 3. Grants: the application reads and appends, nothing else
-- ---------------------------------------------------------------------------

grant select, insert on policy_change_requests, policy_change_request_replies to app_runtime;
