-- 0024: the person who created an MCP key can never decide a request raised through that key
-- (review finding F-INT-01, DECISIONS.md decision 26, which sent this rule to the week-two plan).
--
-- Strictly additive. One nullable column on approval_requests, and one function replaced with
-- CREATE OR REPLACE whose 0008 body is kept word for word and extended by one refusal at the end.
-- No column is redefined, no row is touched, no trigger is dropped: the trigger created by 0008
-- still names the same function and simply runs the longer body.
--
-- WHY THE RULE EXISTS. Maker-checker asks two different PEOPLE to raise and to decide a money-out.
-- Migration 0008 compares approval_requests.requested_by with approval_decisions.decided_by, which
-- are two user ids. An MCP key breaks that comparison: a staff_approver who mints a key for the
-- staff_ops user raises a request that carries the OPERATOR's user id, then decides it as
-- themselves. Two different user ids, one human being on both sides of the gate. Decision 26 shut
-- that door at the screen (line one: only staff_ops create keys, app/api/mcp-keys/route.ts). This
-- migration shuts it at the database, for every route, now and for any code written later.
--
-- WHY A COLUMN RATHER THAN THE PAYLOAD. Slice B11 already writes "MCP API key cmk_xxxxxxxx (human)"
-- into approval_requests.payload, for the approver to read. That sentence is written for a person;
-- matching a key by parsing it would be a join on prose. The new column holds the key's id, so the
-- trigger joins on a foreign key and cannot mistake one key for another, or be fooled by a payload
-- that says something else.
--
-- mcp_api_keys.created_by already exists (migration 0018) and lib/mcp/keys.ts already fills it with
-- the session user of the staff member who pressed the button, so nothing has to be added there.
-- It is null only for a key made by scripts/create-mcp-key.ts, and a null creator refuses nobody:
-- the rule below fires on an equality, never on a null.

-- ---------------------------------------------------------------------------
-- 1. Which key raised the request, as a foreign key
-- ---------------------------------------------------------------------------

-- Nullable, and null for every request raised by a person on a screen, which is most of them.
-- Existing rows keep the value they have, which is null: nothing is rewritten and no meaning
-- changes. Written at INSERT time by lib/approvals/approvals.ts, inside the transaction that
-- creates the request, because approval_requests can never be updated afterwards.
alter table approval_requests
  add column raised_through_key_id uuid references mcp_api_keys (id);

-- ---------------------------------------------------------------------------
-- 2. The maker-checker trigger of 0008, with one more refusal
-- ---------------------------------------------------------------------------

-- The four refusals, in the order a reader would ask them:
--
--   1. the decider must not be the person who asked        -> that is self-approval;
--   2. the decider must exist as a user;
--   3. the decider's role must be exactly 'staff_approver' -> this is also how an agent, whose
--      role is 'agent', can never approve;
--   4. NEW: when the request was raised through an MCP key, the decider must not be the person
--      who created that key.
--
-- Refusal 4 comes last on purpose: the three older refusals keep the exact sentences the
-- application, the screens and the existing checks already match on.
create or replace function enforce_maker_checker_on_approval_decision() returns trigger
language plpgsql as $$
declare
  requester_user_id   uuid;
  decider_role        text;
  key_creator_user_id uuid;
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

  -- The join returns no row when the request was raised on a screen (raised_through_key_id is
  -- null), and key_creator_user_id stays null, so nothing is refused. It also stays null for a
  -- key created by a script, which belongs to no person.
  select key.created_by into key_creator_user_id
    from approval_requests request
    join mcp_api_keys key on key.id = request.raised_through_key_id
   where request.id = new.request_id;

  if key_creator_user_id is not null and new.decided_by = key_creator_user_id then
    raise exception 'maker-checker: the person who created the key that raised this request cannot decide it (request %)', new.request_id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;
