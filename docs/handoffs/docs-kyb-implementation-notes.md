# Implementation notes: document generation (B4/B8) and broker KYB (B3)

Delegate working in an isolated worktree, 2026-09-08. Branch
`worktree-agent-a57fff2de35fb2c53`, worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a57fff2de35fb2c53`, based on
`32a521b`. Nothing was pushed and nothing outside `lib/documents/`, `lib/kyb/`,
`package.json`, `package-lock.json` and this file was touched.

## 1. Startup receipt

Read in full before writing any code, in this order:

- `CLAUDE.md`, `AGENTS.md`, `AUTOMATIC-FAILS.md`, `READABLE-CODE.md`
- `WORKFLOW-48H.md`, `REVIEWER.md` (required of every delegate by `AGENTS.md`)
- `docs/BRIEF-REFERENCE.md` (general requirements and Track 1)
- `docs/ARCHITECTURE.md` (whole file, including sections 3, 4 and 8)
- `docs/DECISIONS.md` (all entries, including the KYB decision of 08:55Z and the California
  premium tax decision of 09:29Z)
- `docs/reviews/FINDINGS.md`
- `docs/PLAN.md` (whole backlog, slices B3, B4 and B8 in particular)
- `docs/STATUS.md` (current state, to know what B1 and B2 already own)
- `lib/stripe.ts`, `lib/money/dates.ts`, `lib/money/premium.ts`, `lib/money/dates.test.ts`,
  `lib/money/premium.test.ts`
- `app/api/webhooks/stripe/route.ts` (read only, to see how events arrive)
- `db/migrations/0001_ledger_core_and_webhook_inbox.sql` and
  `db/migrations/0003_seal_journal_entries_and_truncate_guards.sql` (read only, for the
  vocabulary)
- `package.json`, `tsconfig.json`, `.gitignore`, `.githooks/pre-commit`

Not read: `READINESS-CHECKLIST.md`, `STRESS-TEST-PLAN.md`, `READINESS-BACKLOG.json`,
`GAP-REVIEW.md`, `docs/reviews/architecture.md`, `docs/reviews/b1-ledger-core.md`
(advisory or out of this scope; `FINDINGS.md` carries the retained findings).
Absent files: none of the files named in the assignment were missing.
`docs/handoffs/` did not exist and was created for this note.

Acceptance criteria worked on: B4/B8 document generation ("declarations and endorsement PDFs
must actually be generated from data and support historical dates") and B3 broker KYB
("provider statuses mapped to local eligibility; binding refused unless approved").
Planned checks: `npm test` offline, `npm run typecheck`, `npm run build`, a real Stripe
test-mode round trip for the KYB adapter, gitleaks on the staged content before each commit.

## 2. Commits on this branch

| SHA | What |
|---|---|
| `97b79a9` | `feat: policy documents generated from events (declarations, endorsement schedule)` |
| `7f37d76` | `feat: broker KYB on Stripe Connect Accounts v2 (test mode)` |

A third commit adds this note.

## 3. Module 1: `lib/documents/`

Reading path, in order: `policy-snapshot.ts` (what a document needs) → `policy-as-of.ts`
(how it is rebuilt from events) → `format.ts` (how cents become text) → `render.tsx` (the two
PDFs). `pdf-text.ts` and `example-policy.ts` exist for the tests.

- **`policy-snapshot.ts`** — the `PolicySnapshot` value both documents read. Every money
  field is an integer number of cents and says so in its comment. Two fields were added
  beyond the assignment, both because the endorsement schedule cannot be printed without
  them: `AppliedEndorsement.annualPremiumCentsAfter` (the running annual premium; the
  endorsement's own `premiumDeltaCents` is a *prorated* amount and cannot be added up into
  one) and `annualPremiumCentsAtIssuance` (where that running column starts). Also
  `stateName` and `taxRateBasisPoints`, needed for the "California premium tax (2.35%)" line
  the assignment asks for.
- **`policy-as-of.ts`** — `foldPolicyEvents(events, asOf, generatedAt)`. Rules are written
  out above the function: events effective after `asOf` are ignored; an event undone by a
  `correction_reversal` effective by `asOf` is dropped along with the reversal itself; a
  `correction_rebook` applies as the kind of event it names in
  `payload.rebookedEventType`; the survivors are replayed in business order (effective date,
  then recording time, then id) so the result never depends on the caller's array order.
  Malformed events throw with the event id and the field name rather than printing a wrong
  document. The database mapping is in one comment block at the top of `PolicyEventPayload`
  — **that is the block to align with slice B2's `policy_events` columns.**
- **`format.ts`** — `formatCents` and friends. The conversion runs on the digits of the
  integer (`"125320"` → `"1253"` + `"20"`), so there is no division and no float in the
  file at all. Also `formatBasisPoints`, `formatCalendarDate` ("March 1, 2028", never
  `03/01/2028`) and `formatUtcTimestamp`, which refuses anything that is not UTC.
- **`render.tsx`** — `renderDeclarationsPdf` and `renderEndorsementSchedulePdf`, both
  returning a `Buffer` from `@react-pdf/renderer`'s `renderToBuffer` on the Node runtime.
  Only the standard PDF fonts (Helvetica) are used, so rendering never downloads or reads a
  font file. The PDF metadata timestamps are set from `snapshot.generatedAt` rather than the
  clock, which makes two renders of the same snapshot byte-identical (there is a test).
  The endorsement schedule is landscape: five columns do not fit across a portrait page.
- **`write-sample-documents.ts`** — writes both documents for the worked example to a
  directory, so a human can open them and so the evidence pack has real files:
  `node --import tsx lib/documents/write-sample-documents.ts /tmp`. No database, no provider.
- **`pdf-text.ts`** — reads the text back out of a PDF we produced (inflate the content
  streams with `node:zlib`, decode the hexadecimal strings inside the `TJ` operators). It
  exists so the tests assert on what is printed rather than on the byte count, and it adds
  no dependency. Caveat used in the tests: adjacent runs on one line are separate `TJ`
  operators, so an assertion is on a token ("$1,253.20", "POL-2028-000001"), not on a whole
  sentence.

### The `@react-pdf/renderer` import is dynamic on purpose

`@react-pdf/renderer` 4.9.0 is published as ES modules only, and its transitive dependency
`@react-pdf/hyphenate` declares no CommonJS entry (`"exports"` has an `import` condition and
nothing else). The test runner (`node --import tsx --test`) compiles our files to CommonJS,
so a top-level `import { Document } from "@react-pdf/renderer"` becomes a `require()` and
dies with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Verified, both the failure and the fix:

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './en-us' is not defined by
"exports" in .../node_modules/@react-pdf/hyphenate/package.json
```

`await import("@react-pdf/renderer")` inside the two render functions keeps Node on its ES
module path and works. Node caches the module, so the cost is paid once per process.

## 4. Module 2: `lib/kyb/`

Reading path: `eligibility.ts` (the decision, pure) → `stripe-connect.ts` (the two calls) →
`fixtures/` (four real Stripe responses).

**Deviation from the assignment, deliberate:** `mapAccountToEligibility` and
`parseAccountUpdatedEvent` live in `lib/kyb/eligibility.ts`, not in `stripe-connect.ts`.
`stripe-connect.ts` imports `lib/stripe.ts`, which throws at import time when
`STRIPE_SECRET_KEY` is unset. `npm test` does not load `.env.local`, so a test importing
`stripe-connect.ts` would fail before running. Splitting the pure decision from the network
call keeps `npm test` offline and follows `READABLE-CODE.md` ("separate pure calculations
from provider calls"). `stripe-connect.ts` also exports `readBrokerEligibility`, which does
both for the callers that want one line.

The SDK already does what the coordinator's facts required: `stripe@22.6.1` pins
`ApiVersion = '2026-08-26.dahlia'` (`node_modules/stripe/esm/apiVersion.js`) and exposes
`stripe.v2.core.accounts.create/retrieve` with full types. No `rawRequest`, no second
client, no hand-written fetch.

### What was measured on the sandbox, and what it changed

Two things the account body needed beyond the coordinator's list, both found by running it:

1. `defaults.profile.business_url` and `identity.attestations.terms_of_service.account`
   (`date` + `ip`). Without them the account keeps four `past_due` requirements for ever and
   the recipient capability never becomes `active`, so no broker could ever be approved.
   `startBrokerVerification` therefore takes `businessUrl`, `termsOfServiceAcceptedAt` and
   `termsOfServiceAcceptedFromIp`: a `dashboard: "none"` account cannot accept Stripe's
   agreement itself, so the platform passes on the acceptance it collected. **The UI in B3
   must actually collect that click and pass the real instant and IP; they must not be
   invented.**
2. `business_url` is validated: `https://example.com` is rejected with
   `url_invalid`. The probes use the deployed application URL.

The finding that shaped the mapping:

- The account is created and `stripe_balance.stripe_transfers` is `active` **immediately**.
- The result of the business identity check arrives **45 to 50 seconds later** (three runs
  out of three, polled every 5 seconds), as a new requirement entry
  `identity.business_details.id_numbers.us_ein` carrying
  `verification_failed_tax_id_match` for EIN 111111111.
- **In those first 45 seconds an account whose EIN will fail is indistinguishable from one
  whose EIN passes.** The two checked-in fixtures prove it: `account-pending-just-created.json`
  and `account-approved.json` are the same account at two moments and differ only in an
  unrelated `identity.business_details.documents` sub-object. Stripe exposes no
  "check in progress" flag — not on the v2 account, and not on its v1 view either
  (`requirements.pending_verification` stays `[]`, checked on all three accounts).

So the mapping cannot approve on "no identity requirement is outstanding" alone: it would
approve a broker whose check had not come back. `mapAccountToEligibility` therefore refuses,
in this order: live-mode account → `unknown`; no `requirements` on the payload → `unknown`;
any error code starting with `verification_failed` → `failed` with that code; any entry
naming the business identity, or that Stripe is working on itself, or that names nothing at
all → `pending`; recipient capability absent or not `active` → `unknown` / `pending`;
account younger than `VERIFICATION_SETTLING_SECONDS` (120) → `pending`. Approved is what is
left when nothing refuses.

**The settling window is a floor, not a guarantee** (a slower check could return after it),
and it is only safe in one direction: it can delay an approval, never grant one early. The
real trigger is the `account.updated` event, which must make B3 re-read the account. B3
should keep the local state at `pending` from creation and let events move it; the window
only stops a read taken seconds after creation from reporting an approval nobody made.

### Stripe's "pending" EIN does not produce a pending state

`222221005` is published as the pending-directory-response fixture. Run twice, an account
created with it comes back exactly like a verified one (no identity requirement, capability
active) and maps to **approved** after the settling window. Recorded in the test
`EIN 222221005, which Stripe documents as pending, is approved here` and in the fixture
`account-ein-documented-as-pending.json`, so nobody demonstrates a pending broker with it.
The pending state that is real, and demonstrable at the debrief, is the first minute after a
broker is submitted: create the account on screen and the broker is pending until Stripe
answers. **This is a live-fire answer the coordinator should know about**: the brief asks for
"pending and failed as well as approved", and pending is honestly available, just not from
that EIN.

### Thin v2 events, noted not implemented

`parseAccountUpdatedEvent` handles the v1 `account.updated` event, which is what the deployed
endpoint is registered for and which fires for v2 accounts too. Stripe also emits thin v2
events (`v2.core.account[requirements].updated`) carrying only the changed section; they need
their own event-destination configuration and a fetch of the related object. Noted as a later
improvement in the file; nothing in the code pretends they are handled.

## 5. Checks actually run

| Check | Command | Result |
|---|---|---|
| Offline test suite | `npm test` | **PASS** — 64 tests, 63 passed, 1 skipped (the live Stripe test), 0 failed |
| Types | `npm run typecheck` | **PASS**, no output |
| Production build | `npm run build` | **PASS** — compiled, TypeScript finished, 5 static pages, routes `/`, `/api/health`, `/api/webhooks/stripe` |
| Live Stripe sandbox | `RUN_LIVE_STRIPE_TESTS=1 node --env-file=.env.local --import tsx --test lib/kyb/stripe-connect.live.test.ts` | **PASS** — 1 test, 131.7 s |
| Secret scan, staged | `gitleaks protect --staged --redact --no-banner --no-color` (pre-commit hook, `git config core.hooksPath .githooks` set in this worktree) | **PASS** — "no leaks found" on both commits |

Test counts by file: `lib/documents/format.test.ts` 5, `lib/documents/policy-as-of.test.ts`
18, `lib/documents/render.test.ts` 5, `lib/kyb/eligibility.test.ts` 19,
`lib/kyb/stripe-connect.live.test.ts` 1 (skipped), plus the 16 existing money tests.

Live test output, verbatim:

```
# probe accounts: acct_1UDMRhK6R3QDW861 acct_1UDMRlK6R3ail0An acct_1UDMRpK6R3PGGliF
# EIN 222221005 maps to approved: business identity settled and recipient capability active
ok 1 - a broker account created in the Stripe sandbox maps to the right eligibility
  duration_ms: 131711.638167
```

The document tests assert on the real content of the generated PDFs, not only on the header:
the declarations page for the recited example contains `POL-2028-000001`,
`Blue Ridge Contracting LLC`, `March 1, 2028`, `$1,200.00`, `California`, `2.35%`, `$28.20`,
`$25.00` and `$1,253.20`; the schedule contains `$435.61`, `-$148.77` and the running
premiums `$1,200.00`, `$1,800.00`, `$1,500.00`.

## 6. Not verified

- **No PDF is rendered from a Next.js route.** `lib/documents` is not imported by anything
  under `app/`, which is out of my scope, so the renderer has only been exercised under Node
  and `tsx`, never inside a Vercel function. See the proposed `next.config.ts` change below;
  it is the known risk of this module.
- **No database.** `foldPolicyEvents` was never fed rows from `policy_events`; the payload
  shape is my proposal and the coordinator has to align it with slice B2 (one comment block,
  named above).
- **The documents were reviewed on screen by me, not by Yoann.** I rendered both to PNG
  (`qlmanage -t`) and looked at them: layout, column widths and the footers are right, and
  two defects found that way are fixed (a duplicated "Coverage" heading, a cramped date
  column). Nobody else has seen them. Worth 60 seconds of Yoann's eyes before the demo;
  `write-sample-documents.ts` produces the files.
- **The settling window has not been tested against a slow check.** Every observed run
  answered in 45 to 50 seconds.
- **`external_account` is never satisfied**, so `stripe_balance.payouts` stays restricted on
  every probe account. Irrelevant to KYB eligibility (the identity is what gates binding) but
  it means these accounts cannot receive a real payout. Commission is not paid through
  Stripe Connect in this build, so nothing depends on it.
- The v2 thin events, and any KYB provider other than Stripe.

## 7. Changes I propose but did not make

1. **`next.config.ts`, before B4 renders a PDF from a route.** `@react-pdf/renderer` pulls in
   `pdfkit`, which reads font metrics at runtime and is a known bundling problem in
   serverless output. If the first PDF route fails at runtime with a missing file or a
   `require` error, add:

   ```ts
   const nextConfig: NextConfig = {
     // @react-pdf/renderer and pdfkit are ES-module-only and read font files at runtime;
     // bundling them into the serverless output breaks that. Keep them external.
     serverExternalPackages: ["@react-pdf/renderer"],
   };
   ```

   Unverified: I could not test it without adding a route. Try the route first.
2. **Nothing to change in `tsconfig.json`.** `jsx: "react-jsx"` is already set and `tsx`
   honours it, so JSX in `.tsx` files compiles under both `tsc --noEmit` and the test runner.
   No flag was needed.
3. **Nothing to change in the `test` script.** `node --import tsx --test lib/**/*.test.ts`
   expands, under `sh`, to `lib/*/*.test.ts`, which already picks up `lib/documents/` and
   `lib/kyb/`. Worth knowing: a test file placed directly in `lib/` or three levels deep
   would be silently skipped.
4. **The route that serves a PDF must run on the Node runtime** (`export const runtime =
   "nodejs"`, which is the default for route handlers). The renderer uses `Buffer` and
   `node:zlib`; it cannot run on the Edge runtime.

## 8. Dependency added

`@react-pdf/renderer` at exactly `4.9.0`, as instructed, with `--save-exact`. It brings 59
transitive packages (`pdfkit`, `@react-pdf/*`, `yoga-layout`); `npm audit` reported 0
vulnerabilities. Nothing else was added.

## 9. Stripe test-mode accounts created

Fourteen connected accounts, all `livemode: false`, all with metadata
`corgi_probe = "kyb-adapter-test"` and a display name starting with "Test Brokerage". No
real company, no real person, no live key: `lib/stripe.ts` refuses anything but `sk_test_`.

The three the checked-in fixtures come from (final live-test run, 10:40 UTC):

| Account | EIN | Fixture | Maps to |
|---|---|---|---|
| `acct_1UDMRhK6R3QDW861` | 000000000 | `account-approved.json` and `account-pending-just-created.json` | approved / pending |
| `acct_1UDMRlK6R3ail0An` | 111111111 | `account-failed-tax-id-mismatch.json` | failed, `verification_failed_tax_id_match` |
| `acct_1UDMRpK6R3PGGliF` | 222221005 | `account-ein-documented-as-pending.json` | approved (see section 4) |

Earlier probes, kept in the sandbox and harmless, listed so nobody wonders where they came
from: `acct_1UDMDAK6R3QTtrhJ`, `acct_1UDMDKK6R3RozrBQ`, `acct_1UDMDTK6R3wZLPq6` (first shape,
without the terms-of-service attestation); `acct_1UDMGOK6R3j4yj27`,
`acct_1UDMGTK6R3xLixUF`, `acct_1UDMGXK6R3bv40e0` (first run with it);
`acct_1UDMJQK6R3O0pFMB`, `acct_1UDMJdK6R3h1dfDG` (the two "Delta" timing probes that measured
the 45-second delay); `acct_1UDMNzK6R3mxQl5B`, `acct_1UDMO3K6R3GqEnwH`,
`acct_1UDMO7K6R3jVw7D5`, `acct_1UDMPQK6R340VZBc`, `acct_1UDMPUK6R32cxfzA`,
`acct_1UDMPXK6R3ivHFAW` (two live-test runs before the settling wait was right). They are
separate from the coordinator's three feasibility probes of 08:53 UTC
(`acct_1UDKmAK6R3nWBqMW`, `acct_1UDKmDK6R39jqMi4`, `acct_1UDKmIK6R3fxfHN9`, metadata
`corgi_probe = "kyb-feasibility"`).

`.env.local` was copied into this worktree, is ignored by `.gitignore` (`.env*`), was never
printed, logged or committed, and no value from it appears anywhere in these files.

## 10. For Yoann to decide

1. **The settling window of two minutes.** It is a measurement (45 to 50 seconds, three
   times), not a Stripe guarantee. A broker who signs up is told "verification in progress"
   for two minutes even when everything is right. Shorter is riskier, longer is more
   annoying. This is a money-adjacent rule (it gates binding), so it should be his call and
   recorded in `docs/DECISIONS.md`, not mine.
2. **Which state to demonstrate as "pending" at the debrief**, given that Stripe's published
   pending EIN does not produce one. The honest demonstration is the first minute after
   submitting a broker.
3. **Whether `startBrokerVerification` should collect the Stripe services agreement** in our
   own UI (it must, for the account to be usable) and what the acceptance screen says. That
   is a real legal-facing sentence, not a technical detail.
4. Whether the endorsement schedule should show the prorated delta, the annual change, or
   both. It currently shows the prorated delta plus the running annual premium, with a
   footer sentence explaining the difference.
