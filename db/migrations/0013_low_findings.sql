-- 0013: the two database facts the LOW review findings asked for. Both are additive: an index
-- and a constraint are created, no row is read, rewritten or deleted, and no existing object is
-- dropped or altered.

-- F-B2-19 (B2 re-review). appendSucceededEventOnce (lib/payments/collection.ts) guards its
-- insert with `where not exists`, which two concurrent deliveries of the same payment can both
-- pass, so one money operation could end up with two 'succeeded' rows. There is no money effect
-- (the journal's unique key on (source_kind, source_id, entry_type) is what stops a second
-- posting), but the operation's own history would say the money arrived twice, and every screen
-- and the reconciliation read that history. This index makes "at most one success per operation"
-- a fact of the database instead of a race the application usually wins; the insert now says
-- `on conflict ... do nothing`, so the loser of the race reads as "already recorded".
--
-- Checked on 2026-09-08 before writing this file: no operation carries two 'succeeded' rows,
-- neither on the trial database nor on corgi_test.
create unique index money_operation_events_one_succeeded_per_operation
  on money_operation_events (operation_id)
  where status = 'succeeded';

-- F-B7-09 (B7 review). journal_entries.claim_id has carried claim ids since slice B7 with no
-- reference to claims: the column was created in migration 0001, and claims did not exist until
-- 0008. Nothing can write a wrong value today, because the id always comes from a snapshot that
-- was read from claims, so this constraint writes the rule down rather than repairing anything.
--
-- NOT VALID then VALIDATE is the ordinary two-step: the first statement adds the constraint for
-- new rows without scanning the table, the second scans the existing rows without blocking
-- readers or writers. Checked on 2026-09-08 before writing this file: no journal entry carries a
-- claim_id that is absent from claims, on the trial database (3 entries carry one) or on
-- corgi_test (189).
--
-- It adds no privilege requirement for the application: PostgreSQL runs the referential checks
-- as the owner of the referencing table, and app_runtime already reads claims anyway.
alter table journal_entries
  add constraint journal_entries_claim_id_fkey
  foreign key (claim_id) references claims (id) not valid;

alter table journal_entries validate constraint journal_entries_claim_id_fkey;
