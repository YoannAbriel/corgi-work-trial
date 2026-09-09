-- 0026: when an access token stops answering. One nullable column on mcp_api_keys, and nothing
-- else: no column is redefined, no row is touched, no trigger is dropped or replaced.
--
-- WHY. Until now a token answered for ever and only a revocation row ended it (migration 0018).
-- Yoann's decision of 2026-09-09: a token is tied to a person's account, and a credential tied to
-- a person has to stop on its own when nobody remembers to revoke it. The screen offers 7, 30, 90
-- days, 1 year, or never, and 90 days is the default; the choice itself is a list in
-- lib/mcp/key-format.ts, so the values a person can pick are readable in one place.
--
-- WHAT NULL MEANS: this token has no end date and answers until it is revoked. Every row created
-- before this migration keeps that meaning, which is exactly the meaning it had when it was
-- written, so nothing is rewritten and no existing fact changes (finding F-B9-09: a column never
-- changes meaning). A NON-NULL value is the instant after which POST /api/mcp refuses the token
-- with 401, the same status a revoked token gets.
--
-- WHY THE COLUMN IS NOT A PROBLEM FOR AN APPEND-ONLY TABLE. mcp_api_keys carries a BEFORE UPDATE
-- OR DELETE trigger that raises for every role, the owner included (0018). Expiry does not fight
-- it: the instant is written ONCE, by the INSERT that creates the token, and is never moved
-- afterwards. Extending a token is creating another one, exactly as losing a secret is. That is
-- also why the column is not "revoked_at with a different name": the end of a token is still a
-- fact written when the token is born, never an edit made later.
--
-- PRIVILEGES: 0018 granted SELECT and INSERT on the whole table to app_runtime, and a table-level
-- grant covers columns added afterwards, so the runtime role can read and write this one with no
-- new grant. It still has no UPDATE and no DELETE.

alter table mcp_api_keys
  add column expires_at timestamptz;

comment on column mcp_api_keys.expires_at is
  'When this token stops answering /api/mcp. Null: no end date, it answers until it is revoked. Written once by the INSERT that creates the token and never moved: the table can never be updated.';
