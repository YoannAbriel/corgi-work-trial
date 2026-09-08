-- 0018: the MCP surface (slice B11): per-user API keys, their revocations, and a log of every
-- call. Strictly additive: three new tables, one new trigger function, and one CHECK on users
-- that is WIDENED (a value is added to the list, none is removed), so every existing row still
-- satisfies it and no column is redefined. Nothing from 0001 to 0017 is dropped or rewritten.
--
-- What this slice adds to the system: an HTTP endpoint an autonomous agent can call
-- (app/api/mcp/route.ts). It exposes three read tools, one tool that runs the reconciliation
-- job, and ONE write tool, which only puts a claim payment into the human approval queue of
-- slice B7. No tool moves money, and no tool approves anything: the list of operations that are
-- never delegated is in lib/mcp/never-delegated.ts and is returned by tools/list.
--
-- ---------------------------------------------------------------------------------------
-- Why these three tables are append-only like the money tables
-- ---------------------------------------------------------------------------------------
--
-- They are not money rows, so they are not protected by AF-03 itself. They carry the same
-- guards anyway, for the reason webhook_events and reconciliation_runs do: they record who was
-- allowed to ask what, and what an agent actually asked. An UPDATE on any of them would let
-- somebody re-point a key at another user, or make a call disappear, after the fact. So:
--
--   1. a BEFORE UPDATE OR DELETE trigger that raises for every role, the owner included;
--   2. a BEFORE TRUNCATE trigger;
--   3. the recording time set from the database clock, never from the client;
--   4. app_runtime holds SELECT and INSERT and nothing else.
--
-- THE SHAPE OF A REVOCATION follows from rule 1. A key cannot be revoked by writing a date into
-- its own row, because no row here can ever be updated. Revoking is INSERTING one row into
-- mcp_key_revocations, and "revoked" is read as "a revocation row exists for this key". This is
-- the same reading the reconciliation screen uses for a resolved break (0011): a fact is added,
-- never erased. It also means a revocation carries who did it and when, which an overwritten
-- column could not.

-- ---------------------------------------------------------------------------
-- 1. An MCP principal may be an agent
-- ---------------------------------------------------------------------------

-- Slice B7 wrote the promise this statement keeps (migration 0008, above
-- enforce_maker_checker_on_approval_decision): "Slice B11 creates a user per MCP API key with
-- the role 'agent'; because this trigger demands exactly 'staff_approver', such a principal is
-- refused here, by the database". Adding the value makes an agent principal representable, so
-- that refusal can be exercised for real rather than argued about.
--
-- Widening only: 'broker', 'customer', 'staff_ops' and 'staff_approver' still pass, so no row in
-- users can be invalidated by this. An 'agent' user is refused at the login form
-- (app/api/session/login/route.ts): an agent presents an API key, never a browser session.
alter table users drop constraint users_role_check;
alter table users add constraint users_role_check
  check (role in ('broker', 'customer', 'staff_ops', 'staff_approver', 'agent'));

-- ---------------------------------------------------------------------------
-- 2. Server-clock trigger for called_at
-- ---------------------------------------------------------------------------

-- Same idea as set_recorded_at_from_database_clock() (0001), set_created_at_from_database_clock()
-- (0002) and set_finished_at_from_database_clock() (0011), for the column named called_at. One
-- small function per column name, so each stays readable on its own.
create or replace function set_called_at_from_database_clock() returns trigger
language plpgsql as $$
begin
  new.called_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. mcp_api_keys: one row per key, and a key is never edited
-- ---------------------------------------------------------------------------

create table mcp_api_keys (
  id             uuid primary key default gen_random_uuid(),
  -- WHOSE EYES THIS KEY HAS. Every read tool answers with this user's visibility and nothing
  -- more: a broker's key sees that broker's policies, a customer's key that customer's, a staff
  -- key everything. There is no separate permission model to keep in step with the screens.
  user_id        uuid not null references users (id),
  -- What a person calls this key on the staff screen, e.g. "Claude Desktop, laptop".
  label          text not null,
  -- The public half of the key, stored in clear and shown on screens and in the call log. It is
  -- the first two segments of the presented key, so a person can tell two keys apart without
  -- anybody ever writing the secret down. Not a credential on its own.
  key_prefix     text not null unique check (key_prefix ~ '^cmk_[0-9a-f]{8}$'),
  -- sha256 of the WHOLE presented key, hex. The secret itself is never stored, never logged and
  -- never returned by any read: it is printed once, by the script or the screen that created it.
  -- A lookup hashes what the caller presented and matches on this column (lib/mcp/keys.ts).
  key_hash       text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  -- WHO HOLDS THE KEY, which is not the same question as what it may see:
  --   'human'  a person using an MCP client on their own behalf;
  --   'agent'  an autonomous agent. Every approval request raised through an agent key says so
  --            in its payload, so the approver reads "raised by an agent" before deciding.
  principal_kind text not null check (principal_kind in ('human', 'agent')),
  -- The staff member who created it on /ops/mcp-keys; null when scripts/create-mcp-key.ts did.
  created_by     uuid references users (id),
  created_at     timestamptz not null default now()   -- overwritten by the trigger below
);

create index mcp_api_keys_by_user on mcp_api_keys (user_id, created_at);

-- AN AGENT KEY CAN NEVER BELONG TO AN APPROVER. General non-negotiable 6 says an agent cannot
-- approve. The endpoint cannot approve at all (there is no such tool, and /api/approvals accepts
-- session cookies only), and the trigger of 0008 refuses any decider whose role is not
-- staff_approver. This trigger closes the remaining door from the other side: it refuses to
-- CREATE an agent key for the one role that could decide, so an agent principal never holds an
-- approver's visibility in the first place.
create or replace function forbid_agent_key_for_an_approver() returns trigger
language plpgsql as $$
declare
  holder_role text;
begin
  select role into holder_role from users where id = new.user_id;
  if holder_role is null then
    raise exception 'mcp key: user % does not exist', new.user_id
      using errcode = 'foreign_key_violation';
  end if;
  if new.principal_kind = 'agent' and holder_role = 'staff_approver' then
    raise exception 'mcp key: an agent principal cannot hold a staff_approver key; agents never approve money out'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger mcp_api_keys_agent_is_never_an_approver
  before insert on mcp_api_keys
  for each row execute function forbid_agent_key_for_an_approver();

create trigger mcp_api_keys_are_append_only
  before update or delete on mcp_api_keys
  for each row execute function forbid_change_of_financial_record();

create trigger mcp_api_keys_cannot_be_truncated
  before truncate on mcp_api_keys
  for each statement execute function forbid_truncate_of_financial_record();

create trigger mcp_api_keys_created_at_is_server_set
  before insert on mcp_api_keys
  for each row execute function set_created_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- 4. mcp_key_revocations: one row per revoked key, and that row is the revocation
-- ---------------------------------------------------------------------------

create table mcp_key_revocations (
  id          uuid primary key default gen_random_uuid(),
  -- Unique: a key is revoked once. A second attempt is refused by the database rather than
  -- quietly recorded twice, which would make "when was it revoked" ambiguous.
  api_key_id  uuid not null unique references mcp_api_keys (id),
  revoked_by  uuid references users (id),   -- null when a script revoked it
  reason      text,
  recorded_at timestamptz not null default now()   -- overwritten by the trigger below
);

create trigger mcp_key_revocations_are_append_only
  before update or delete on mcp_key_revocations
  for each row execute function forbid_change_of_financial_record();

create trigger mcp_key_revocations_cannot_be_truncated
  before truncate on mcp_key_revocations
  for each statement execute function forbid_truncate_of_financial_record();

create trigger mcp_key_revocations_recorded_at_is_server_set
  before insert on mcp_key_revocations
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- 5. mcp_calls: what was asked, by which key, and how it ended
-- ---------------------------------------------------------------------------

create table mcp_calls (
  id             uuid primary key default gen_random_uuid(),
  -- The key that made the call, INCLUDING a revoked one: a revoked key still in use is exactly
  -- what an operator wants to see. Null when the caller presented no key or a key we do not
  -- know, because there is no row to point at and nothing from the presented value is stored
  -- (it could be somebody's real secret typed into the wrong terminal).
  api_key_id     uuid references mcp_api_keys (id),
  -- The JSON-RPC method: 'initialize', 'tools/list', 'tools/call', or 'unknown'.
  method         text not null,
  -- The tool of a tools/call, null for every other method.
  tool           text,
  -- sha256 of the canonical JSON of the arguments (lib/mcp/keys.ts, hashArguments). The
  -- arguments themselves are NOT stored: two calls can be recognised as identical without this
  -- table holding a policy number, an amount or anything else a payload might carry.
  arguments_hash text check (arguments_hash ~ '^[0-9a-f]{64}$'),
  -- 'ok'            the tool answered;
  -- 'refused'       the caller was not allowed to see or do it, or the input was rejected;
  -- 'error'         something broke on our side;
  -- 'unauthorised'  no key, an unknown key, or a revoked key: the answer was 401.
  outcome        text not null check (outcome in ('ok', 'refused', 'error', 'unauthorised')),
  -- One short sanitised sentence, the same one the caller was given. Never a payload, never a
  -- stack trace, never a secret (AGENTS.md, Operations and security).
  detail         text,
  duration_ms    integer not null check (duration_ms >= 0),
  called_at      timestamptz not null default now()   -- overwritten by the trigger below
);

create index mcp_calls_by_key on mcp_calls (api_key_id, called_at desc);

create trigger mcp_calls_are_append_only
  before update or delete on mcp_calls
  for each row execute function forbid_change_of_financial_record();

create trigger mcp_calls_cannot_be_truncated
  before truncate on mcp_calls
  for each statement execute function forbid_truncate_of_financial_record();

create trigger mcp_calls_called_at_is_server_set
  before insert on mcp_calls
  for each row execute function set_called_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- 6. Grants: the endpoint reads with the runtime role and appends, nothing else
-- ---------------------------------------------------------------------------

grant select, insert on mcp_api_keys, mcp_key_revocations, mcp_calls to app_runtime;
