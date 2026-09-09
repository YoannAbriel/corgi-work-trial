# B13-9: the operations console (v1)

Linear YOA-638. Read-only, staff-only, server-rendered, no migration, no write route of its own.

## What it is

Seven screens under `/ops/console`, for the person who has to diagnose the system while it is
running.

| Screen | What it answers |
|---|---|
| `/ops/console` | what happened since a cursor, how long each step is taking, what failed or is unresolved |
| `/ops/console/search` | what is this reference, and what is its trail |
| `/ops/console/infra` | what this deployment uses, next to the documented free-plan limits |
| `/ops/console/customer/{customerId}` | everything about one customer |
| `/ops/console/broker/{brokerId}` | everything about one broker |
| `/ops/console/policy/{policyId}` | everything about one policy |
| `/ops/console/claim/{claimId}` | everything about one claim |

## Where the code is

| File | What it holds |
|---|---|
| `lib/console/read.ts` | every reader: the feed, the latency percentiles, the errors and unknowns, the reference search, and the panels of the 360 pages |
| `lib/console/infra.ts` | the infrastructure measurements, and the table of documented limits |
| `lib/console/access.ts` | who may open the console, as a pure function of the role |
| `lib/console/guard.ts` | the same rule applied to the current request |
| `lib/console/safe-read.ts` | `attempt`, which turns a failed read into one red line instead of an error page |
| `components/console-parts.tsx` | the feed table, the masked-identity fold, the recovery cell, the time and duration formatting |
| `components/console-360.tsx` | the shared 360 page; the four routes are four-line wrappers around it |
| `scripts/check-console.ts` | the evidence, `npm run check:console` |

## How to read a screen

1. **The feed page.** Latency strip at the top, then the errors panel, then what is being checked,
   then the feed. On the right: the window and kind filters, the map of which table each kind
   comes from, and the explanations under folds. The page carries
   `<meta http-equiv="refresh" content="10">`, so it reloads itself every ten seconds with no
   JavaScript, and a "Refresh now" button (a plain GET form) is there for the moment ten seconds
   is too long. The refresh keeps the query string, so the filters and the cursor survive it.
2. **A 360 page.** Identity band, then money operations with their timeline and the two durations,
   the provider events that named their references, the journal through the same `JournalTable`
   the policy and claim screens use, the policies and claims, and the merged timeline. On the
   right: identity, open breaks, approvals, statements and verification (broker only), change
   requests, and MCP calls (customer and broker only).
3. **The search.** Type a reference, get what it is, then its trail. The page names the SHAPE it
   recognised before saying whether anything matched, so "nothing found" is never ambiguous.

## What is derived from which table

| What you see | Read from |
|---|---|
| feed, kind `money` | `money_operation_events` joined to `money_operations`, and to `policies` through `policy_id` or through the claim |
| feed, kind `webhook` | `webhook_events` left-joined to `webhook_processing`; the only payload path read is `data.object.id` |
| feed, kind `journal` | `journal_entries`; the amount is the sum of the entry's debits, from `journal_lines` |
| feed, kind `policy` | `policy_events` |
| feed, kind `claim` | `claim_events` |
| feed, kind `approval` | `approval_requests` and `approval_decisions`, as two separate rows |
| feed, kind `reconciliation` | `reconciliation_runs` |
| feed, kind `statement` | `statement_runs` |
| feed, kind `mcp` | `mcp_calls`, joined to `mcp_api_keys` for the public prefix only |
| feed, kind `kyb` | `broker_kyb_events` |
| feed, kind `change_request` | `policy_change_requests`, with the existence of a reply |
| "Request to provider acceptance" | `money_operation_events`: `min(recorded_at) where status='requested'` to `min(recorded_at) where status='provider_accepted'` |
| "Provider acceptance to success" | the same table, `provider_accepted` to `succeeded` |
| "Webhook received to processed" | `webhook_events.received_at` to `webhook_processing.updated_at`, on the rows that read `done` |
| "MCP call" | `mcp_calls.duration_ms`, which the endpoint measured itself |
| "Reconciliation run" | `reconciliation_runs.started_at` to `finished_at` |
| errors: money | `money_operation_events` with status `failed` or `unknown`, and the sanitised `reason` of the payload |
| errors: webhook | `webhook_processing` with status `failed` or `ignored`, **or `attempts > 1`** |
| errors: MCP | `mcp_calls` with outcome `error` or `refused` |
| errors: reconciliation | `reconciliation_runs` with status `failed` |
| errors: unknown outcome | the latest event of each operation, when it is `provider_accepted` |
| policy 360 identity | `policies`, `customers`, `brokers`, and the `policy_current` cache for the status (labelled "status (cache)") |
| open breaks on a 360 page | `openBreaks()` from `lib/reconciliation/read.ts`, filtered to this object's operation ids and provider references |
| infra: database size, tables, connections | `pg_database_size`, `pg_stat_user_tables`, `pg_stat_activity` |
| infra: last scheduled run | `max(reconciliation_runs.finished_at) where run_by is null`, which is the only trace the application keeps of the cron having fired |
| infra: documented limits | a table in `lib/console/infra.ts`, read from the providers' own pages on 2026-09-09 |

## The 15-minute rule, stated as an assumption

> An operation whose latest `money_operation_events` row is `provider_accepted` and that has said
> nothing for **15 minutes or more** is shown as an **unknown outcome**. Under 15 minutes it is
> shown as **checking**, in its own small panel.

This threshold is **an assumption of this build**. It is not a Stripe rule, not a Corgi rule and
not a promise about anything: Stripe documents no delay between accepting a request and delivering
the event that confirms it. It is a reading convention that decides which of two panels an
operation appears in, and it changes no money and no state. The constant is
`UNKNOWN_OUTCOME_AFTER_MINUTES` in `lib/console/read.ts`, and the sentence is printed on the page
next to the panel it governs.

What actually resolves such an operation is `/api/jobs/recover-operations`, which asks the provider
by the stable idempotency key or by the provider reference and appends the real outcome. The
console only makes the operation visible.

## Rules this slice keeps

- **No write, anywhere.** No route, no form and no action of this slice changes a row. The two
  forms rendered next to a problem post to endpoints that already existed: `/api/jobs/reconcile`
  (the reconciliation screen's "Run now") and `/api/brokers/{brokerId}/kyb/recheck` (the brokers
  screen's re-read). The claim payment send form is **linked to**, not re-implemented, because it
  carries an approval check that belongs on the claim page.
- **Staff only.** `lib/console/access.ts` answers `allow` for `staff_ops` and `staff_approver`,
  `/login` for anonymous, `/customer` for a customer and `/broker` for a broker or an agent. None
  of the readers takes a user or scopes by one, which is exactly why the rule has no third answer.
- **Every path id goes through `isUuid`**, and a path that is not a uuid is a 404, never a 500
  from a query casting the text.
- **Sanitised text only.** No provider payload, no secret, and no API key beyond its public `cmk_`
  prefix. Every string taken from a payload is cut at 220 characters.
- **Names and emails are masked** to their first three characters, revealed by a native
  `<details>`. This is a reading discipline for a screen left open on a desk, not a security
  control: the console is already staff-only and the value is in the HTML. An actor that is not a
  person (`stripe`, `the ledger`, `the daily scheduled job`, a `cmk_` prefix) is printed as it is:
  every feed row carries `actorIsPerson`, and masking a provider name would be noise, not
  discretion.
- **Bounded reads.** The feed asks each source for at most 60 rows and renders at most 200. Every
  360 panel is scoped by the policy and claim id lists that `consoleSubject` read once, so no
  panel loops over rows issuing queries.
- **One panel cannot take the page down.** Every read goes through `attempt`; a panel whose query
  fails prints one red line and the rest of the page renders. The console is what an operator opens
  while something is already broken.

## Known limits of v1

- **The webhook-to-object join is a bounded scan.** A provider event has no foreign key into our
  tables; what links it is the id inside the payload (`data.object.id`, `data.object.payment_intent`).
  There is no index on a jsonb path and this slice adds no migration, so the query filters
  `webhook_events` and caps the result. The proper fix is an expression index on those two paths,
  which is a migration and belongs to another slice.
- **MCP calls cannot be attached to a policy or a claim**, because `mcp_calls` stores a hash of the
  arguments and never the arguments (migration 0018). The link that exists is the key, and a key
  borrows one user's visibility, so the panel is on the customer and broker pages only and says why.
- **The latency lookback is 48 hours.** A pair whose first instant is older than the window plus
  the lookback is not measured at all; the sample count on the tile says how many were.
- **The infrastructure page calls no provider API.** It measures our own Postgres and prints the
  documented limits from a table in the code. Vercel function duration, memory, invocations and
  bandwidth are not measurable from here and the page says so instead of showing a number nobody
  measured.
- **`unauthorised` MCP calls are not in the errors panel.** They are a caller with no valid key, so
  they appear in the feed under the `mcp` kind and there is nothing for an operator to repair.

## Evidence

`npm run check:console`, on `corgi_test`, with the restricted runtime role for every read.
It creates a small fixture (one broker, one customer, two policies, one claim, one row in every
table the console reads) and runs nothing else; it does not run `scripts/seed.ts` and touches no
existing row.

It proves: the feed returns the fixture's events newest first and represents all ten kinds it
wrote; the `since` cursor and the kind filter are honoured; the five latency tiles are numbers
computed by Postgres and never NaN; the unknown-outcome rule splits the same real operation both
ways (with the real threshold it reads "checking", with a threshold of zero it reads "unknown
outcome" — a fixture row cannot be made sixteen minutes old, because `recorded_at` is set by the
database clock); each of the nine reference shapes resolves; a broker, a customer, an agent and an
anonymous visitor are all sent away, and the MCP surface exposes no console tool; the 360 readers
of one policy return that policy's rows and none of another policy's; and the role the console
reads with holds `SELECT` on every table it reads and `UPDATE` or `DELETE` on none of them.

## 2026-09-09T11:17Z note (coordinator)

UI-025 of the desktop audit (docs/ui-audit-2026-09-09.json) replaced the meta refresh described above: since 2a3e5bf (merged a2068c1) the console refreshes through a client timer that calls router.refresh() every 10 seconds and is cleared when the page unmounts, so navigating away no longer brings the user back. The "Refresh now" button is unchanged and still works without JavaScript; the automatic refresh now needs JavaScript. Lines of this note and of docs/reviews/b13-9-console.md that describe the meta tag are historical.
