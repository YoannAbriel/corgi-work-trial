-- 0021: the activity log, one row per request the application answers (decision 25, F-RC-07).
-- Strictly additive: it creates one table and its guards. Nothing from 0001 to 0020 is dropped,
-- altered or redefined, and no existing column changes meaning.
--
-- WHAT THIS ADDS TO THE SYSTEM. Until now the application answered a request and forgot it. The
-- money path left journal entries, the MCP endpoint left mcp_calls, the webhook inbox left
-- webhook_events, but a refused endorsement, a slow policy screen or a 500 left nothing at all:
-- an operator could see the effects of what worked and nothing of what did not. This table is
-- the record of the request itself: who asked, which route, on which object, how long it took,
-- how it ended, and the correlation id that ties the row to the JSON line the server printed.
--
-- WHO WRITES IT. One helper, lib/observability/log.ts (withActivity), wrapped around every
-- route handler under app/api, the cron job routes, the MCP endpoint and the Stripe webhook.
-- Nothing else inserts here, and the helper never lets a failed insert break a request.
--
-- ---------------------------------------------------------------------------------------
-- WHAT THIS TABLE MUST NEVER HOLD, and how the schema enforces it
-- ---------------------------------------------------------------------------------------
--
-- THERE IS NO PAYLOAD COLUMN. Not "payload jsonb null", not "request_body text". AGENTS.md
-- (Operations and security) asks for structured redacted logs with correlation ids and NOT full
-- request and response bodies, and AF-05 says sandbox credentials are secrets too. A column
-- that can hold a body will one day hold a bearer token, and this table can never be updated or
-- deleted, so that token would sit here for the life of the database. The way to make that
-- impossible is to have nowhere to put it.
--
-- `message` is the only free text, and it is one sanitised sentence produced by
-- lib/observability/redact.ts: an email masked to its first three characters, a bearer token, a
-- password field and a sk_ / rk_ / whsec_ secret replaced, newlines collapsed, length capped.
-- Never a stack trace: the helper reads error.message and never error.stack.
--
-- ---------------------------------------------------------------------------------------
-- Why an operations log carries the guards of the money tables
-- ---------------------------------------------------------------------------------------
--
-- It holds no money, so AF-03 does not protect it by itself. It carries the same guards anyway,
-- for the reason mcp_calls, webhook_events and policy_change_requests do: it records what was
-- asked and what was refused. An UPDATE would let somebody rewrite the reason an action was
-- refused, or the time it took; a DELETE would make a refusal disappear from the history the
-- console reads. So, exactly as in 0018 and 0019:
--
--   1. a BEFORE UPDATE OR DELETE trigger that raises for every role, the owner included;
--   2. a BEFORE TRUNCATE trigger;
--   3. the recording time set from the database clock, never from the client;
--   4. app_runtime holds SELECT and INSERT and nothing else.
--
-- scripts/check-money-guards.ts proves all four on a real database, with activity_log in its
-- list of protected tables.

create table activity_log (
  id             uuid primary key default gen_random_uuid(),
  recorded_at    timestamptz not null default now(),   -- overwritten by the trigger below

  -- THE CORRELATION ID. One request, one id, printed on the JSON line and stored here, so a
  -- line in a Vercel log and a row on the console screen can be recognised as the same request.
  -- It is taken from the incoming x-request-id header when the caller sent one (a proxy, a
  -- reviewer's curl, a load test) and generated as a uuid otherwise. Because a caller can
  -- choose it, it is text and not uuid, it is sanitised by the helper, and it is bounded here:
  -- a header is untrusted input, and an unbounded one is a way to write a megabyte per request.
  correlation_id text not null check (char_length(correlation_id) between 1 and 200),

  -- WHO ASKED. The user id and the role when a signed-in person made the request; both null for
  -- the cron secret, for Stripe and for anyone not signed in.
  actor_user_id  uuid references users (id),
  actor_role     text,
  -- 'human'      a signed-in person, or an MCP key held by a person;
  -- 'agent'      an autonomous agent, recognised by the principal_kind of its MCP key;
  -- 'cron'       the Vercel cron job, authenticated by CRON_SECRET;
  -- 'anonymous'  nobody signed in: the login form, a session that expired, a health check;
  -- 'stripe'     the webhook endpoint, whose caller is a signature and not a user.
  actor_kind     text not null check (actor_kind in ('human', 'agent', 'cron', 'anonymous', 'stripe')),

  -- WHICH ROUTE, as the PATTERN and not as the URL: '/api/policies/[policyId]/endorsements',
  -- never '/api/policies/3f2a.../endorsements'. Two reasons. The percentile panel groups by this
  -- column, and a per-id URL would make every row its own group with one sample. And a URL can
  -- carry a query string, which can carry anything a caller typed.
  route          text not null check (char_length(route) between 1 and 200),
  method         text not null check (char_length(method) between 1 and 10),

  -- WHICH OBJECT, when the route names one. These are the four objects the console has a 360
  -- page for, so the "Activity" panel of a page is one index lookup on (subject_kind, subject_id).
  -- Both null on a route that names no object (the login form, a job, the health check).
  subject_kind   text check (subject_kind in ('policy', 'claim', 'broker', 'customer')),
  subject_id     text check (char_length(subject_id) between 1 and 64),
  check ((subject_kind is null) = (subject_id is null)),

  duration_ms    integer not null check (duration_ms >= 0),

  -- HOW IT ENDED, and this is the whole point of the table:
  --   'ok'       the handler answered normally;
  --   'refused'  a rule said no. Either the handler threw one of the application's refusal
  --              classes, or it answered a 4xx, or it redirected with ?error= in the location,
  --              which is how most screens of this application say no;
  --   'error'    something broke: an unexpected throw, or a 5xx.
  outcome        text not null check (outcome in ('ok', 'refused', 'error')),

  -- THE RULE A REFUSAL NAMED, in the words a person uses: 'maker-checker', 'cron secret',
  -- 'MCP tool scope'. Null on an ok row, and null on a refusal whose rule cannot be named
  -- (a redirect carrying only a sentence). Saying "refused" without saying by what is what makes
  -- an operations log useless during an incident.
  rule           text check (char_length(rule) between 1 and 100),

  -- ONE SANITISED SENTENCE, and nothing that resembles a payload, a stack, an email or a key.
  message        text check (char_length(message) between 1 and 500),

  status_code    integer not null check (status_code between 100 and 599)
);

-- The two reads this table has. The console feed and the latency panel read the newest rows of a
-- window; a 360 page reads one object's rows.
create index activity_log_by_time    on activity_log (recorded_at desc);
create index activity_log_by_subject on activity_log (subject_kind, subject_id, recorded_at desc);
-- The reference search resolves a correlation id, so that lookup gets its own index rather than
-- a scan of the whole table.
create index activity_log_by_correlation on activity_log (correlation_id);

create trigger activity_log_is_append_only
  before update or delete on activity_log
  for each row execute function forbid_change_of_financial_record();

create trigger activity_log_cannot_be_truncated
  before truncate on activity_log
  for each statement execute function forbid_truncate_of_financial_record();

create trigger activity_log_recorded_at_is_server_set
  before insert on activity_log
  for each row execute function set_recorded_at_from_database_clock();

-- The application appends and reads, nothing else.
grant select, insert on activity_log to app_runtime;
