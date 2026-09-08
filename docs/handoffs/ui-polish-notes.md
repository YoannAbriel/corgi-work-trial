# Interface polish after the 18:27Z walkthrough

Branch `worktree-agent-ac8c2ce5122970811`, branched at `9809b0e`, merged with `origin/main`
(`e7d7856`, B11 MCP surface) before this note was written. Findings addressed: F-UI-01 (screens
read as raw text, no tables and no actions behind a control), F-UI-02 (Stripe identifiers inline),
F-UI-03 (no per-role notification, no badge on Approvals), F-UI-04 (refund banner wording), the
reviewer item on `/login` rendering inside the workspace shell, and the coordinator's addendum on
money fields.

Nothing under `db`, `scripts`, `app/api` or the Vercel configuration changed. `lib` changed only to
add the six read functions listed below. No new dependency.

## What changed, screen by screen

| Screen | Change |
|---|---|
| Sidebar (`components/portal-shell.tsx`) | A count next to Policies, Claims, Approvals and Reconciliation when something waits for the signed-in person. Read on the server; a screen reader hears "3 waiting for you". |
| `/ops` (`components/workspace-overview.tsx`) | "What needs you" block above the map of screens: one line per waiting item, with the count and a link. |
| `/broker`, `/customer` | Same block, with what waits for that role (an endorsement the customer has to approve, or that the broker is waiting on). |
| `/ops/policies` | Status shown as a badge; the two explanatory paragraphs moved into "How to read this". |
| `/ops/claims` | Explanation of incurred and paid moved into "How to read this". |
| `/ops/claims/[claimId]` | The four forms (set the reserve, record the bank account, request a payment, close) are grouped in one Actions area, each behind its own disclosure. Payment row actions (send, settle, return) open from the row. Money operation id, transfer reference, approval request id and the simulated account token moved behind the sandbox affordance. |
| `/ops/approvals` | The queue is now two tables (waiting, decided) with a fixed column set. The decision opens per row and shows the exact hashed text above the form. The B11 "raised through MCP" line stays visible in the row, never folded away. |
| `/ops/reconciliation` | Four long paragraphs became titled disclosures next to the list each one explains. The run form opens from "Run a reconciliation now". The provider reference stays visible in the break table (it is the identity of the break and what an operator types into the provider console); the ledger operation id and the break key moved behind the affordance. |
| `/ops/statements` | Explanation and the run form behind disclosures. The content hash column was replaced by the affordance on the month cell. |
| `/statements/[runId]` | Content hash and run id behind the affordance. |
| `/policies/[policyId]` | Documents, endorse, cancel and open-a-claim moved behind disclosures, so the page shows the terms, the schedule, the refunds, the claims and the journal first. Checkout session, payment intent, refund id, operation ids and the correction event id moved behind the affordance. Refund row actions (re-issue, send) open from the row. Cancellation banner reworded from the refund states (below). |
| `/policies/[policyId]/cancel` | The refunded PaymentIntent moved behind the affordance. |
| `/ops/brokers`, `/broker/kyb` | The `acct_` connected account moved behind the affordance. |
| `/login` | Rendered by `components/signed-out-frame.tsx`: brand, sandbox disclosure, skip link and footer, no workspace sidebar. |
| `/broker/policies/new`, endorse form, claim reserve and payment | Money fields group thousands as they are typed and echo "= $1,200.00" underneath. |

Every disclosure is a native `<details>` rendered on the server. No client state library, no
`<dialog>`, no JavaScript of ours except the money field. The simulator labels (LOCAL SIMULATOR),
the "not a dedicated KYB vendor" line and the threshold-is-an-assumption sentences are all still on
their screens.

## The badge reads added

Six functions, each next to the reads it belongs with. They count, they never decide.

| Function | File | Counts |
|---|---|---|
| `countApprovalRequestsWaitingForDecision` | `lib/approvals/read.ts` (new file) | approval requests with no row in `approval_decisions` |
| `countOpenBreaks` | `lib/reconciliation/read.ts` | the same rule as `openBreaks`, reusing its two SQL fragments, with `count(*)` |
| `countClaimsWithPaymentsStillToMove` | `lib/claims/read.ts` | claims with a `claim_payout` operation that has no `payment_sent` event and no `failed` lifecycle event, the same condition `pendingPaymentCents` uses |
| `countPoliciesPaidButNotBound` | `lib/policy/read.ts` | `policy_current.status = 'paid_not_bound'` |
| `countEndorsementsPaidButNotApplied` | `lib/policy/read.ts` | collections that succeeded with an `application_refused_reason` and no later `endorsed` event |
| `countEndorsementsAwaitingCustomerApproval` | `lib/policy/endorsement-read.ts` | reuses `liveEndorsementRequest` per policy, scoped to one customer or one broker |

`components/what-needs-you.tsx` assembles them per role and words each line for the person reading
it. It catches a failed read and returns no task: a count is a hint, and a page must not fail to
render because a hint could not be read. The screens themselves show the state and the server
enforces every rule.

`PortalShell` is now async and computes the tasks itself, so every screen shows the same numbers.
`/ops`, `/broker` and `/customer` read them once and pass them in, so nothing is read twice.

## Money fields

`components/money-amount-input.tsx` is the only client component added. It groups the whole-dollar
digits in threes while the person types, keeps at most two decimals, puts the caret back after the
same digit, and prints "= $1,200.00" under the field.

It formats, it never computes: no addition, no proration, no rounding, and no amount from the
database is formatted in the browser. Everything the application displays still goes through
`formatCentsAsUsd` on the server.

There is no hidden field and no server parser change. The visible field keeps its own name and its
`required` attribute (a hidden field cannot be focused when validation fails, and two fields can
drift apart), and it submits what the person sees, `1,200.00`. `parseUsdAmountToCents` already
accepts thousands separators and a dollar sign and already refuses `1 200,50`, three decimals and
everything else; `lib/money/cents.test.ts` already covers both. Nothing in `lib` was touched for
this item.

## Refund banner (F-UI-04)

`cancellationRefundNotice` in `app/policies/[policyId]/page.tsx` reads the refunds the cancellation
opened and names each group separately: waiting for a second person (nothing sent), recorded and
owed but not sent yet, sent to Stripe and not confirmed, completed, failed. The old sentence
claimed every refund "were sent to Stripe", including one sitting in the approval queue.

## Forms: no change

`.local/source-form-contract.sh` lists every `method=`, `action=` and `name=` declared in `app/`.
Between `e7d7856` (the merge parent) and this branch head the two lists are 155 lines each and
`diff` reports nothing. The rendered HTML was checked too, with `.local/form-contract.mjs`, which
extracts each form's method, action and field names from the served document: the approvals
decision form, the four claim forms, the endorse and cancel previews, the two document forms, the
claim form and the login form all post the same endpoint with the same field names, types,
values and `required` flags.

Role and ownership checks were not touched on any page. Nothing that shows money became a client
component.

## Checks actually run

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | 404 tests, 403 pass, 1 skipped (the opt-in live Stripe test), 0 failures |
| `npm run build` | PASS, compiled successfully, every route still server-rendered on demand |
| Source form contract, `e7d7856` against HEAD | identical, 155 lines each |
| HTTP renders, dev server on port 3900 against the disposable `corgi_test` database, as anonymous, ops, approver, broker and customer | see the table below |

No check script was run against `corgi_test`, and nothing was written to any database: the dev
server only read, and signing in is a `select` on `users`. The server was stopped at the end.

## What I did not do

- `/` (the anonymous home) keeps the workspace shell. Only `/login` was named in the finding.
- `/ops/mcp-keys` (B11, merged from main) was left exactly as its builder wrote it.
- The provider reference stays visible in the reconciliation break table, deliberately: it is the
  identity of the row. Everything else there is behind the affordance.
- `/ops/policies` reads every broker and then that broker's policies one at a time. On the
  disposable check database (275 brokers, 679 policies) that render takes minutes. It is
  pre-existing and untouched, in `lib`, and out of this scope; worth a look before submission.
- The counts run on every page of the workspace. On the check database, which holds hundreds of
  runs, the four small counts total about 350 ms and the open-break count dominates. On the trial
  database the volumes are two orders of magnitude smaller.
- No independent review of this work yet, no deployment, no push.
