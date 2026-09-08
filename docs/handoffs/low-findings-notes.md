# The LOW review findings, closed one by one

Written by the delegate builder on branch `worktree-agent-aaa927eeba1eca638`, branched from
`b5211c7`. The coordinator merges, reviews, deploys and owns STATUS, DECISIONS and FINDINGS;
none of those files was touched here. One commit per finding, in the order below.

## Before merging: migration 0013

`db/migrations/0013_low_findings.sql` is additive (one partial unique index, one foreign key)
and **must be applied to the trial database before the deployment that carries this code**. The
`on conflict (operation_id) where status = 'succeeded'` clause in `appendSucceededEventOnce`
names that index, so the collection path fails on a database that does not have it yet. Order:
migrate, then deploy.

The disposable database has it: the index was applied by the runner, and the foreign key was
applied by hand afterwards (the file was already recorded in `schema_migrations` when the
constraint was added to it, so the runner would have skipped it). A fresh database gets both
statements from the file, in one transaction.

## What changed, finding by finding

### F-B7-08: the payment in the URL now has to belong to the claim in the URL

`assertPaymentBelongsToClaim` in `lib/claims/payments.ts`, called on the first line of the try
block of `app/api/claims/[claimId]/payments/[operationId]/route.ts`. It reads the operation and
refuses when its `claim_id` is not the claim named in the path. The refund routes already made
the same check, so this removes an inconsistency rather than a money hole: the stages read the
claim from the operation, so the money always landed on the right claim.

Proof: two lines in `scripts/check-claims-and-approvals.ts` (a payment of another claim is
refused with "this payment belongs to another claim"; the owning claim passes).

### F-B7-10: settling checks its own actor

`SettleClaimPaymentInput.broughtForwardBy` (a nullable user id) became `settledBy`, which is
either a `ClaimActor` or `SCHEDULED_JOB`. `settleClaimPayment` calls `assertClaimsOperatorOrJob`
itself, and the user id recorded on the claim event and the journal entry is derived from the
same value. The route no longer carries its own role check, because the function now does it.
`SCHEDULED_JOB`, `assertClaimsOperatorOrJob` and `actorUserId` live in `lib/claims/claims.ts`.

Proof: one line in the claims check (the approver cannot settle: "only staff operations can act
on a claim").

### F-B7-06: a loss cannot be dated in the future

`claimCoverageRefusal` (`lib/claims/coverage.ts`) takes `today` and refuses an `occurredAt`
after it, before it looks at the covered period. `OpenClaimRequest` takes `openedOn`, which the
route fills from `todayUtc()` (the server clock, never the form). `reportedAt` before
`occurredAt` was already refused and still is.

**Consequence the coordinator has to weigh.** On the trial database the only bound policy,
CGP-01274, starts cover on 2026-09-17, nine days from now, so no new claim can be opened there
until that date: a loss inside the cover is necessarily in the future. CLM-00212, opened by the
reviewer for a loss dated 2026-09-20, is untouched (nothing was rewritten), and the claims
screens still show it. If the demo needs a new claim before 2026-09-17, the policy it is opened
on has to have started, which is a seeding decision, not a code one.

`reportedAt` is still not bounded above by today. A claim reported "in the future" is nonsense
too, but the review asked for the loss date and nothing in the product produces such a report
(the form is filled by an operator on the day). Left as it is, deliberately.

Proof: three unit tests in `lib/claims/coverage.test.ts` (a future loss is refused, a loss dated
today is not, and the day of the reading is an argument), plus one line in the claims check that
opens a claim with the real `todayUtc()` against the 2028 fixture policy and reads the refusal.

### F-B7-05: the recovery job finishes stuck claim payments

`stuckOperations` (`lib/payments/recover.ts`) now selects `claim_payout` as well, and the
per-operation decision moved into an exported `recoverStuckOperation`, which the job calls in a
loop. The claim branch calls `sendClaimPayment`, the same function the claim screen's button
calls, with `SCHEDULED_JOB` as the actor: the approval, the destination account and the three
ceilings are all re-checked there, so a payment waiting for an approver is left alone with the
approver's own refusal as the reason. `stuckOperations` also takes the age in minutes, which the
job leaves at its default of five and the check passes as zero.

Proof: four lines in the claims check (the query returns claim payouts; an unapproved payment is
left alone, quoting "waiting for a second person"; a below-threshold payment is sent; running it
again does not pay twice). The five-minute age cannot be fabricated, because `created_at` on a
money operation is set by a database trigger and cannot be backdated, which is why the check
passes zero minutes and calls the per-operation function.

### F-B7-07: a malformed id answers 400 or 404, never 500

`lib/http/path-ids.ts`: `isUuid` and `badPathIdResponse`. Ten API routes (approvals, brokers KYB
recheck, both claim routes, and the policy bind, cancel, checkout, claims, refund send and
refund reissue routes) answer 400 with a plain sentence that names the id without echoing it.
Three pages (`/ops/claims/[claimId]`, `/policies/[policyId]`, `/policies/[policyId]/cancel`)
call `notFound()`, which is what an unknown but well-formed uuid already did.

Proof: `lib/http/path-ids.test.ts`, and a local run on port 3600 against the disposable database
(signed in as a staff operator seeded there for the probe):

```
POST /api/claims/not-a-uuid                                  -> 400  the claim in this URL is not a valid identifier
POST /api/approvals/not-a-uuid                               -> 400  the approval request in this URL is not a valid identifier
POST /api/policies/not-a-uuid/checkout                       -> 400  the policy in this URL is not a valid identifier
POST /api/policies/<uuid>/refunds/not-a-uuid/send            -> 400  the refund in this URL is not a valid identifier
POST /api/claims/<uuid>/payments/not-a-uuid                  -> 400  the payment in this URL is not a valid identifier
POST /api/brokers/not-a-uuid/kyb/recheck                     -> 400  the broker in this URL is not a valid identifier
GET  /ops/claims/not-a-uuid                                  -> 404
GET  /policies/not-a-uuid                                    -> 404
GET  /policies/not-a-uuid/cancel?effectiveAt=2028-06-09      -> 404
GET  /ops/claims/<unknown uuid>                              -> 404   (unchanged)
```

The guard sits after the session check, so an anonymous caller is still sent to the login page
rather than told anything about the path.

### F-B2-19: one succeeded row per operation, as a database fact

Migration 0013 adds a partial unique index on `money_operation_events (operation_id)` where
`status = 'succeeded'`. `appendSucceededEventOnce` (`lib/payments/collection.ts`) keeps its
`where not exists` sub-select for the ordinary case and adds `on conflict ... do nothing` for the
race the sub-select cannot see, where two deliveries in flight at the same moment cannot read
each other's uncommitted row. Nothing else in that file changed.

Checked before writing the migration: no operation carries two `succeeded` rows, on the trial
database or on `corgi_test`.

Proof: one line in `scripts/check-payment-replay.ts` (a second success row inserted directly with
the runtime role is refused: `23505
money_operation_events_one_succeeded_per_operation`), and the payment and kyb replay checks still
pass whole.

### F-B2-18: a re-booked policy reads as already posted

`correctionThatReversedOperation` (`lib/payments/collection.ts`) now folds the policy's events
and asks `policyWasVoided` (`lib/policy/status.ts`) before looking for a correction, so a policy
that a `correction_rebook` has bound again is not treated as voided. Before, a late duplicate of
a genuine payment on a re-booked policy would have been refused and landed in the inbox as
ignored. The edit is inside that function plus the import; `lib/policy/status.ts` itself was not
touched.

Proof: two lines in the payment replay check. After the void scenario, a `correction_rebook`
event is fabricated on the disposable database (slice B8 will write it for real), the original
payment is redelivered, and the outcome is `already_posted` with no new entry: four entries under
the operation, eight on the policy.

### F-B3-05: a broker's KYB submission is serialized per broker

`submitBrokerKyb` (`lib/broker/kyb-onboarding.ts`) now runs its guards and its submission insert
in one transaction holding `pg_advisory_xact_lock(hashtext(brokerId))`, the same key
`appendBrokerKybEventIfChanged` takes, so a webhook status and a submission cannot interleave
either. Stripe is still called after that transaction commits, as the outbox rule requires.

The lock alone would not have been enough: the second click's guard reads the latest status row,
and the first click has not written one yet. So the transaction also refuses a submission while
the broker's latest submission has no status row carrying its id and is younger than
`SUBMISSION_IN_FLIGHT_MINUTES` (two minutes: Stripe answers in about four seconds, and a process
that died must not lock the broker out for the afternoon). Both events `submitBrokerKyb` writes,
the failure and the created account, carry `submission_id`, so the hold clears as soon as either
lands. `submissionAwaitingProviderAnswer` in `lib/broker/kyb.ts` is the query.

Proof: three lines in `scripts/check-kyb-replay.ts` (an unanswered submission is seen as in
flight; a second call to `submitBrokerKyb` is refused before the network, with one submission
still on file; the hold clears once the answer is recorded). The true two-process race was not
fabricated: the losing click is exactly the state proven here, and making the winner run for real
would create a Stripe connected account on every run of the check.

### F-B3-04: the settling window ends by itself

`reportedKybStatus` (`lib/broker/eligibility.ts`) takes `now` and holds an approval while
`now - submission < 120 s`, instead of asking when the approval was recorded. An approval that
landed inside the window, which a few seconds of clock skew between Stripe and the database
produces, was held for ever: a re-read appended nothing because the status had not changed, and a
resubmission was refused as already verified. `brokerKybState` is the only caller that reads the
clock, so the rule stays pure.

One case is still held without end, on purpose: an approval recorded BEFORE the submission it is
measured against describes the connected account of an earlier submission and is not evidence
about this one. It is unreachable through `brokerKybState`, which only ever compares an event
with a submission older than itself, and the new submission writes its own row anyway.

Proof: `lib/broker/eligibility.test.ts` rewritten around explicit instants, with a new test for
the corner (held at 90 s, approved at 130 s), and the kyb replay check still reports the seeded
in-window approval as held.

### F-B7-09: journal_entries.claim_id references claims

Migration 0013 again: `not valid`, then `validate`. Nothing violates it. Read before writing the
file: on the trial database 3 journal entries carry a `claim_id` and all 3 name an existing
claim; on `corgi_test`, 189 and all 189 do. The application needs no new privilege, because
PostgreSQL runs referential checks as the owner of the referencing table, and the claims check
posts claim entries with the runtime role after the constraint was added.

## Checks, on this branch

| Check | Result |
|---|---|
| `npm run typecheck` | clean, after every finding |
| `npm run build` | 31 routes, compiled |
| `npm test` | 283 tests, 282 pass, 1 skipped, 0 fail (278 before) |
| `npm run check:claims-and-approvals` | 71/71, exit 0 (63 before) |
| `npm run check:payment-replay` | 32/32, exit 0 (29 before) |
| `npm run check:kyb-replay` | 26/26, exit 0 (23 before) |
| `npm run check:refund-replay` | 27/27, exit 0 |
| `npm run check:reconciliation` | 29/29, exit 0 (its call sites changed here) |
| `npm run check:money-guards -- --database=test` | 127 PASS, 1 FAIL: "owner cannot TRUNCATE brokers (deadlock detected)" |

The money-guards line is contention, not a guard: `corgi_test` is shared by several agents and
the TRUNCATE probes take an exclusive lock. On the coordinator's instruction the check was run
once and not repeated. The claims check also deadlocked twice at different points before running
whole, which is the same shared-database contention.

## Not done, and why

- `reportedAt` is not bounded above by today (F-B7-06 above).
- The two-process KYB race was proven from the loser's side only (F-B3-05 above).
- The money-guards TRUNCATE line was not re-run after its deadlock.
- Nothing was pushed, deployed or merged, and no shared planning file was edited.
