-- 0024: a break note records the report it explained (review finding F-BREAKSBOARD-01).
-- Strictly additive: three nullable columns on reconciliation_break_notes. Nothing from 0001 to
-- 0023 is dropped or altered, and no existing column changes meaning.
--
-- WHAT WAS WRONG. A note was keyed on the break key alone, and the break key is deliberately the
-- money and not the classification (lib/reconciliation/breaks.ts): a break that gets worse keeps
-- its key. So a note written while a break was `stale` went on excluding it from the count, the
-- operations inbox, the MCP tool and the window the daily job widens, for ever, even after a
-- later run reported the same key as `provider_only` with a real difference. The table is
-- append-only and no path supersedes a note, so the exclusion never ended.
--
-- The comment in 0022 (lines 16-17) says a break explained wrongly is still a break and comes
-- back. That was true of the runs, which always kept reporting it, and false of the operator's
-- queue, which never showed it again. This migration is what makes it true of both. 0022 is not
-- edited: an applied migration file never changes, so the correction is written here and in
-- lib/reconciliation/break-notes.ts.
--
-- WHAT A NOTE NOW SAYS: "on this break, as the latest run described it, here is what it is". The
-- description is the classification and the two amounts. A later run that reports the same break
-- differently no longer matches any note, and the break is work again, with its note still on
-- file and shown beside it (lib/reconciliation/read.ts, THE_NOTE_EXPLAINS_THE_LATEST_REPORT).
--
-- The three columns are NULLABLE because the table already exists and rows may already be in it.
-- A note with no recorded classification matches no report, so a break explained before this
-- migration is work again until somebody explains it as it stands today. That is the honest
-- outcome: we cannot know what such a note was about, and a new note takes one form and one
-- click.

alter table reconciliation_break_notes
  -- The classification of the latest report of this break when the note was written. Never
  -- 'matched': a matched record is not a break and cannot be explained.
  add column explained_classification text
    check (explained_classification is null
           or explained_classification in ('local_only', 'provider_only', 'amount_mismatch', 'stale', 'probe')),
  -- The two amounts of that same report, in integer cents, either of which is legitimately null
  -- (a provider-only record has no ledger amount). They are on the note so that a break whose
  -- money changed while its classification did not is work again too.
  add column explained_provider_amount_cents bigint,
  add column explained_ledger_amount_cents   bigint;
