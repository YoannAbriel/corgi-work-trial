-- 0012: broker monthly statements (slice B9).
-- Strictly additive: it creates two tables and their grants. Nothing from 0001 to 0011 is dropped
-- or altered, and neither table is referenced by an earlier migration, so the files apply in any
-- order (0009 is slice B4, built in parallel).
--
-- What a statement is here: a broker's commission account for one calendar month, read from the
-- journal and frozen. It is NOT a cache of the ledger and nothing is ever recomputed from it: the
-- ledger stays the truth, and a run is the record of what the ledger said at one moment.
--
-- THE TWO DATES THAT MAKE A CLOSED MONTH REPRODUCIBLE (Yoann's decision, DECISIONS.md 10:02Z):
--
--   statement_month   the BUSINESS month: the run reads the journal entries whose effective_at
--                     falls inside it. Stored as the first day of the month.
--   knowledge_cutoff  the RECORDING instant: the run reads only entries whose recorded_at is at
--                     or before it. Re-running the same month with the same cutoff reads exactly
--                     the same entries forever, because recorded_at is set by the database clock
--                     and journal rows can never be changed (0001, 0003).
--
-- A correction recorded AFTER the cutoff is therefore invisible to that run, and shows up in a
-- new run with a later cutoff: revision 2, which names revision 1 as the run it supersedes.
-- Nothing is rewritten, and both revisions stay readable side by side.
--
-- Both tables are protected financial records (AF-03), for the same reason as reconciliation_runs
-- (0011): they say what we told a broker they were owed, and rewriting one would change a
-- published figure without anybody correcting anything. Same three guards as every protected
-- table, and app_runtime receives SELECT and INSERT only:
--   1. a BEFORE UPDATE OR DELETE trigger that raises for every role, owner included;
--   2. a BEFORE TRUNCATE trigger;
--   3. the recording time set from the database clock, never from the client.

-- ---------------------------------------------------------------------------
-- statement_runs: one row per run, and a run is never edited
-- ---------------------------------------------------------------------------

create table statement_runs (
  id                uuid primary key default gen_random_uuid(),
  broker_id         uuid not null references brokers (id),
  -- The first day of the month the statement covers, e.g. 2028-03-01 for March 2028. A date
  -- rather than a text "2028-03" so it compares and sorts with the journal's effective_at.
  statement_month   date not null,
  -- 1 for the first run of that broker and month, 2 for the next one, and so on. The unique
  -- constraint below makes a revision number a fact of the database, not of the application.
  revision          integer not null check (revision >= 1),
  -- The recorded_at upper bound this run read. Everything the ledger learned after this instant
  -- is deliberately outside the statement.
  knowledge_cutoff  timestamptz not null,
  -- The run this one replaces: the previous revision of the same broker and month. Null on
  -- revision 1, set on every later revision (the CHECK below states exactly that).
  supersedes_run_id uuid references statement_runs (id),
  -- sha256 of the canonical text of the lines and totals (lib/statements/compute.ts). Two runs
  -- with the same hash listed the same money, whatever their revision number or their cutoff.
  content_hash      text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- True when this run's hash equals the hash of the run it supersedes: a re-run that found
  -- nothing new. It is redundant with comparing the two hashes and is stored so the list of runs
  -- needs no self-join, the same reasoning as the counts on reconciliation_runs (0011).
  identical_to_previous boolean not null default false,

  -- The four figures the brief asks a broker statement to carry, plus the adjustments needed to
  -- make the fourth one true (see the CHECK below). All in integer cents.
  --   premium_collected_cents  cash received from customers on this broker's policies, the way
  --                            the ledger booked it: premium, state premium tax and policy fee
  --                            together, because that is the cash side of a premium_collected
  --                            entry. Commission is earned on the premium alone, which is why
  --                            commission is not this figure times the commission rate.
  --   commission_earned_cents  commission credited to commission_payable in the month.
  --   clawback_cents           commission taken back out of commission_payable in the month,
  --                            stored as a positive number ("how much was clawed back").
  --   adjustment_cents         any other movement of this broker's commission_payable in the
  --                            month. Zero in this build; the column exists so that net due is
  --                            ALWAYS the movement of commission_payable and can never be an
  --                            approximation of it.
  --   net_due_cents            what the broker is owed for the month.
  -- None of them carries a sign check: a reversal recorded in a later month legitimately makes
  -- any of them negative.
  premium_collected_cents bigint not null,
  commission_earned_cents bigint not null,
  clawback_cents          bigint not null,
  adjustment_cents        bigint not null default 0,
  net_due_cents           bigint not null,

  run_by            text,                                -- user id of the staff member, null for a job
  created_at        timestamptz not null default now(),  -- overwritten by the trigger below

  -- One revision number per broker and month, forever. Two runs committing at the same instant
  -- cannot both claim revision N: one of them is refused here and its whole transaction rolls
  -- back, which is the behaviour we want (the loser simply runs again and becomes N+1).
  unique (broker_id, statement_month, revision),
  -- A statement month is a whole month, named by its first day.
  check (extract(day from statement_month) = 1),
  -- Revision 1 replaces nothing; every later revision replaces exactly one earlier run.
  check ((revision = 1) = (supersedes_run_id is null)),
  -- The arithmetic of the statement, at the database boundary: what the broker is owed is what
  -- was earned, less what was clawed back, plus anything else that moved the payable.
  check (net_due_cents = commission_earned_cents - clawback_cents + adjustment_cents)
);

create index statement_runs_by_broker_and_month on statement_runs (broker_id, statement_month, revision desc);
create index statement_runs_by_time on statement_runs (created_at desc);

create trigger statement_runs_are_append_only
  before update or delete on statement_runs
  for each row execute function forbid_change_of_financial_record();

create trigger statement_runs_cannot_be_truncated
  before truncate on statement_runs
  for each statement execute function forbid_truncate_of_financial_record();

create trigger statement_runs_created_at_is_server_set
  before insert on statement_runs
  for each row execute function set_created_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- statement_lines: the journal entries the run listed, one line each
-- ---------------------------------------------------------------------------

-- Every line names the journal entry it comes from, so a figure on a statement can always be
-- traced back to the entry that produced it, and two revisions can be compared entry by entry.
create table statement_lines (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references statement_runs (id),
  -- The order the run printed them in (0, 1, 2, ...). Stored rather than derived, because the
  -- canonical text that was hashed is the lines IN THIS ORDER.
  line_order       integer not null check (line_order >= 0),
  -- What the line is about, in the broker's terms:
  --   premium_collected  cash received from a customer (positive), or the reversal of one
  --   commission_earned  commission credited to the broker
  --   clawback           commission taken back on a refunded premium (negative)
  --   refund             cash given back to a customer (negative), the reason for a clawback
  --   adjustment         any other movement of this broker's commission_payable
  kind             text not null check (kind in
                     ('premium_collected', 'commission_earned', 'clawback', 'refund', 'adjustment')),
  policy_id        uuid references policies (id),
  policy_number    text,                       -- copied so the line reads without a join
  journal_entry_id uuid not null references journal_entries (id),
  effective_at     date not null,              -- the entry's business date: what puts it in this month
  -- The entry's own recorded_at. It is at or before the run's knowledge_cutoff by construction,
  -- and it is what makes "a correction recorded after the cutoff is not on this revision" a
  -- statement anyone can check against the journal.
  entry_recorded_at timestamptz not null,
  -- Signed the way the money moves for this kind: money coming in and commission earned are
  -- positive, refunds and clawbacks negative. Only the commission_earned, clawback and
  -- adjustment lines add up to net due; premium_collected and refund lines are the cash they
  -- were computed on.
  amount_cents     bigint not null,
  description      text not null,
  recorded_at      timestamptz not null default now(),  -- overwritten by the trigger below
  unique (run_id, line_order)
);

create index statement_lines_by_run on statement_lines (run_id, line_order);
create index statement_lines_by_entry on statement_lines (journal_entry_id);

create trigger statement_lines_are_append_only
  before update or delete on statement_lines
  for each row execute function forbid_change_of_financial_record();

create trigger statement_lines_cannot_be_truncated
  before truncate on statement_lines
  for each statement execute function forbid_truncate_of_financial_record();

create trigger statement_lines_recorded_at_is_server_set
  before insert on statement_lines
  for each row execute function set_recorded_at_from_database_clock();

-- ---------------------------------------------------------------------------
-- Grants: the run reads the journal with the runtime role and appends here, nothing else
-- ---------------------------------------------------------------------------

grant select, insert on statement_runs, statement_lines to app_runtime;
