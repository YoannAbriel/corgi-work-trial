-- 0020: statement format version 3 (decision 22, 2026-09-09).
--
-- Migration 0016 gave every statement run a format version and allowed the values 1 and 2. The
-- fix of review finding F-B8-08 (each refund line of a statement carries its own premium base)
-- changes the canonical text a statement hashes, so the version moves to 3 with it
-- (lib/statements/compute.ts, CANONICAL_STATEMENT_VERSION).
--
-- WIDENING ONLY. The CHECK gains the value 3; nothing is removed and no column changes meaning:
-- a run written under version 1 or 2 keeps the version it was written with and reads exactly as
-- before (collectedFigures branches on the version it finds). Rows are never updated: a new
-- revision of a month is a new row carrying version 3, and the screen says "format changed, not
-- comparable by hash" between two revisions of different versions.
alter table statement_runs drop constraint statement_runs_canonical_version_check;
alter table statement_runs add constraint statement_runs_canonical_version_check
  check (canonical_version between 1 and 3);
