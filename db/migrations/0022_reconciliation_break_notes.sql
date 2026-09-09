-- 0022: an operator says what a reconciliation break is (decision by Yoann, 2026-09-09).
-- Strictly additive: it creates one table and its guards. Nothing from 0001 to 0021 is dropped,
-- altered or redefined, and no existing column changes meaning.
--
-- WHY THIS TABLE EXISTS. The breaks board showed 28 open breaks and said nothing about any of
-- them, so the only thing an operator could do with a break they had understood was remember it
-- (review finding F-YA-10). A note is that memory, written down: who looked at this break, when,
-- and what they found.
--
-- WHAT A NOTE DOES, AND WHAT IT DOES NOT DO. It repairs nothing. No money moves, no journal entry
-- is posted, no reconciliation row is edited or deleted, and the break is still compared by every
-- later run exactly as before. What changes is one thing only: an explained break leaves the list
-- of breaks TO ACT ON and leaves the inbox, and it stays on the screen under its own heading with
-- the note, its author and its date. A break that was explained wrongly is still a break: the
-- next run reports it again, and the note beside it is what an operator argues with.
--
-- WHY IT CARRIES THE SAME GUARDS AS THE MONEY TABLES. It holds no money, so AF-03 does not
-- protect it by itself. It carries the same guards anyway, for the reason mcp_calls and
-- policy_change_requests do: it records what a person said about a discrepancy. An UPDATE would
-- let an explanation be rewritten after the fact, and a DELETE would let it disappear from the
-- record while the break it removed from the list stays removed. So, exactly as in 0018 and 0019:
--
--   1. a BEFORE UPDATE OR DELETE trigger that raises for every role, the owner included;
--   2. a BEFORE TRUNCATE trigger;
--   3. the recording time set from the database clock, never from the client;
--   4. app_runtime holds SELECT and INSERT and nothing else.
--
-- A CORRECTION IS A NEW NOTE, never an edit: the notes of one break are all on file and the
-- screen shows the latest one, saying how many there are.

create table reconciliation_break_notes (
  id           uuid primary key default gen_random_uuid(),
  -- The identity a break is filed under across runs (lib/reconciliation/breaks.ts, breakKey):
  -- "stripe|op:<uuid>" or "stripe|pi_...". It is deliberately NOT a foreign key to
  -- reconciliation_items: a break has one row per run that reported it, so there is no single
  -- item to point at, and the key is what both sides already agree on. The application refuses a
  -- note on a key no run has ever reported (lib/reconciliation/break-notes.ts).
  break_key    text not null check (char_length(break_key) between 1 and 300),
  -- What the operator found, in their own words. Ten characters at least, so "known" cannot be
  -- a whole explanation; five hundred at most, because this is a note, not a report. The
  -- application trims before inserting, so the bounds are on real text and not on spaces.
  note         text not null check (char_length(note) between 10 and 500),
  -- The staff operations user who wrote it. Read from the session, never from the form.
  explained_by uuid not null references users (id),
  recorded_at  timestamptz not null default now()   -- overwritten by the trigger below
);

-- The one read this table has: the notes of a break, latest first, and the existence test the
-- open-break rule runs for every reported break (lib/reconciliation/read.ts).
create index reconciliation_break_notes_by_break_key on reconciliation_break_notes (break_key, recorded_at desc);

create trigger reconciliation_break_notes_are_append_only
  before update or delete on reconciliation_break_notes
  for each row execute function forbid_change_of_financial_record();

create trigger reconciliation_break_notes_cannot_be_truncated
  before truncate on reconciliation_break_notes
  for each statement execute function forbid_truncate_of_financial_record();

create trigger reconciliation_break_notes_recorded_at_is_server_set
  before insert on reconciliation_break_notes
  for each row execute function set_recorded_at_from_database_clock();

grant select, insert on reconciliation_break_notes to app_runtime;
