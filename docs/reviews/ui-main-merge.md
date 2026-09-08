# Independent review: interface dressing merged into main

Reviewer: independent Claude sub-agent assigned by the coordinator. I did not write any of this
code and I did not review it before the merge. Review performed 2026-09-08, roughly 18:15Z to
18:35Z.

Reviewed revision: merge `856e75c0d63c2c5e4324a27a3b8935d734cfc11e`, parents `bfa2dca` (main) and
`66fb7fe` (branch `codex/corgi-interface`), merge base `e110a7c`. Scope: the diff `e110a7c..856e75c`
restricted to `app/**`, `components/**`, `public/**`, `package.json` and `package-lock.json`.

Deployed revisions measured: `af086358f611cdafbfda3e6087ac5f2695b4bdd2` for the full sweep, then
`c9064d8d270f52caf21bce365665af3829c2e74c` for a repeat of the refusal cases and the login-shell
check. Both are reported by `/api/health`, and the interface files are byte-identical between them:
each is the reviewed merge minus `app/loading.tsx`, which the coordinator removed at 18:15Z after
finding F-UI-00. Every production measurement below is therefore against the merge plus that one
deletion, and I say so where it matters.

Verdict: **PASS** for the interface scope, with F-UI-01 recorded as found in the reviewed revision
and already fixed, and F-UI-02 open as a required correction before submission. Candidate
walkthrough status: **NOT REVIEWED WITH YOANN**.

## Startup receipt

Actually read in full, in this order: `CLAUDE.md`; `AUTOMATIC-FAILS.md` (AF-01 to AF-06);
`READABLE-CODE.md`; `AGENTS.md`; `REVIEWER.md`; `docs/handoffs/ui-main-merge.md`;
`docs/handoffs/ui-01.md`, `ui-02.md`, `ui-03.md`, `ui-04.md`; `docs/reviews/ui-01.md`, `ui-02.md`,
`ui-03.md`, `ui-04.md` (read critically: they were written by the same session that wrote the code,
so they are author evidence, not independent evidence); the six DECISIONS entries timestamped
14:08:52 to 18:04:17 UTC; the latest `docs/STATUS.md` entries including the interface-merge entry
and its 18:15Z amendment; `README.md` deployment and demo-account section.

No mandatory kit file was missing. Next acceptance criterion for this review: the dressing changes
presentation only, every server-side check still runs before rendering, every page renders for
every role on the deployed URL, and the automatic-fail labels survive. Planned checks: mechanical
form-contract comparison against `e110a7c`, guard comparison, production route sweep with real
sessions, refusal tests, viewport measurement, secret scan, licence and asset inspection.

Not authorised and not performed: any write to the trial database, any Stripe or provider call, any
commit, any push, any deployment. My only repository write is this file.

## 1. Business logic untouched

`git diff e110a7c 856e75c --name-only -- lib db scripts app/api vercel.json next.config.ts` returns
two files: `lib/reconciliation/read.ts` and `db/migrations/0017_reconciliation_item_record_date.sql`.
Both come from main's own commit `b1a0bce` (fix F-B10-11 and the 0017 renumber), not from the
interface branch. I confirmed the attribution two ways:

- `git diff bfa2dca 856e75c --name-only` outside `app/`, `components/`, `public/`, `package.json`,
  `package-lock.json` and `docs/` is empty. The merge added nothing under `lib`, `db`, `scripts`,
  `app/api`, `vercel.json` or `next.config.ts`.
- `git diff e110a7c bfa2dca --stat -- app components public package.json` is empty. Main touched no
  interface file between the merge base and the merge, so the whole interface diff is attributable
  to the branch and `e110a7c` is a valid comparison base for it.

The STATUS claim "no change under lib, db, scripts, app/api or the Vercel configuration" is
accurate.

### Form contracts

I wrote my own extractor (scratchpad, not in the repository) that scans every `.ts` and `.tsx` file
under `app/` and `components/` in both revisions and records, for every `form`, `input`, `select`,
`option`, `textarea` and `button`, the attributes that define the server contract: `action`,
`method`, `name`, `value`, `defaultValue`, `type`, `required`, `disabled`, `checked`,
`defaultChecked`, `min`, `max`, `step`, `minLength`, `maxLength`, `pattern`, `multiple`,
`readOnly`. 154 entries before, 154 after. The complete difference is:

| Change | Assessment |
|---|---|
| `businessUrl` input gains `type="url"` (`app/broker/kyb/page.tsx`); name, `required` and `maxLength={200}` unchanged | Aligned with the server rule, not a loosening. `lib/broker/kyb-onboarding.ts:367` already rejects anything not matching `^https?:\/\/\S+$`, so the browser now refuses exactly what the server refuses. |
| Logout form moves out of `app/broker/page.tsx` and `app/customer/page.tsx` into `components/portal-shell.tsx:138`; same `method="post"`, same `action="/api/session/logout"`, same submit button | Deduplication, contract identical. |
| Two new `type="button"` controls: the error-boundary retry (`app/error.tsx`) and the navigation toggle (`components/portal-frame.tsx`) | Neither submits anything. |

No form action, method, field name, submitted value, hidden field, version field, required flag or
numeric constraint changed on any page. The hidden `policyVersion`, `quoteHash`,
`expectedPolicyVersion`, `endorsedEventId`, `correctedEffectiveAt` and `action` fields are all
present and unchanged.

### Server-side role and ownership checks

I compared every line matching `currentUser(`, `redirect(`, `notFound(`, `user.role`,
`user.brokerId`, `user.customerId` and `isUuid` across all `app/**/*.tsx` in both revisions, ignoring
line numbers. No guard line was removed. I then diffed, per file, everything preceding the first
top-level `return (` of the default export, which is where every page does its authentication,
authorisation, id validation and data reading. Across all 24 changed page files the only differences
are: the `PortalShell` import, the `<main>` to `<PortalShell>` wrapper swap, `role="alert"` added to
error paragraphs, and two intentional changes:

- `app/login/page.tsx:14`: an already-signed-in user was redirected to `/broker` unconditionally; a
  staff user now goes to `/ops`. Navigation only, no authorisation change. This is UI-04 finding F02.
- `app/ops/policies/page.tsx` is new. Its guard order is correct: `currentUser()` at line 12,
  `redirect("/login")` at 13, staff-role check and `redirect("/broker")` at 14, and only then, at
  lines 18 to 20, `brokersWithKybState()` and `policiesOfBroker()`. No read happens before the guard.

No check moved, and no page reads data before its guard. I verified this again against the running
deployment in section 3.

### Money in the browser, data in the browser

`app/error.tsx` and `components/portal-frame.tsx` are the only two files carrying `"use client"` in
`app/` or `components/`. Neither imports anything from `lib/`. `PortalFrame` imports `useState`,
`next/link` and three lucide icons; its props are a rendered sidebar node, a rendered children node
and an array of `{ label, href }` strings. No `toFixed`, no `Intl.NumberFormat`, no `formatCents`,
no division or multiplication by 100 anywhere under `components/` or in `app/error.tsx`. Every
breadcrumb label is a fixed string such as "Policy", "Statement detail" or "Endorsement preview";
none carries an amount.

`app/policies/[policyId]/formula-lines.tsx` and `correction-sections.tsx` remain server components.
Their entire diff wraps existing tables in `<div className="table-scroll">`; not one money
expression was touched. `app/ops/policies/page.tsx` formats with the server-side
`formatCentsAsUsd`. No money is computed or formatted in the browser and no client component
fetches data.

## 2. Automatic fails

**AF-02, per-integration labels.** All preserved, and I confirmed them in the deployed HTML, not
only in the source. `LOCAL SIMULATOR` appears 4 times in `app/ops/claims/[claimId]/page.tsx` and
twice in `app/ops/reconciliation/page.tsx`, exactly as before. The `/ops` occurrence moved into
`components/workspace-overview.tsx:100` and reads "Claim payout rail: LOCAL SIMULATOR. Claim payouts
and bank verification are simulated. They do not move real money." The "not a dedicated KYB vendor"
sentence is intact in `app/broker/kyb/page.tsx:50` and `app/ops/brokers/page.tsx:31` and renders on
production for both roles. `KYB_NOT_LIVE_LABEL` still guards the seeded-placeholder disclosure on
five screens. Nothing simulated is presented as live. See F-UI-02 for the app-level disclosure,
which is a separate and weaker point.

**AF-04, no real personal data or company identity.** The only email addresses in visible copy are
`broker@example.com`, `customer@example.com`, `ops@example.com` and `approver@example.com` on the
login page, all on the reserved `example.com` domain. No occurrence of a real person, a real
company, `corgi.insure` or a personal identifier anywhere in `app/` or `components/`. I opened all
three illustrations: `corgi-engraving.webp` is a grayscale engraving of a corgi with a shield and a
paper stack, `corgi-desk.webp` a clay-style corgi at a laptop, `corgi-landscape.webp` a clay-style
landscape. No person, no logo, no legible text in any of them. On production the policy page shows
synthetic identities such as "Santa CaFE" and `customer-33a18c4d@example.com`.

**AF-05, no committed secrets.** `gitleaks 8.30.1` on the reviewed range
(`gitleaks git --log-opts="e110a7c..856e75c"`): 10 commits, 251 KB, no leaks. A manual scan of the
UI-scope diff for `sk_live`, `sk_test`, `pk_`, `whsec_`, `AKIA`, `-----BEGIN`, bearer tokens and
assignment-shaped `password=`/`secret=` returns nothing. A full working-tree `gitleaks dir` reports
212 findings, and I classified every one: 185 in `.claude/worktrees/*/.env.local`, 10 in
`.worktrees/`, 11 in `.env.local`, `.env.vercel.local` and `.next`. Zero of the 212 are in a
tracked file, and every containing path is git-ignored. `.env.local` is ignored by `.gitignore:20`.

**Fonts and external loads.** `public/fonts` carries four WOFF2 files and two OFL texts. I decoded
all four with fontTools 4.60.1: they identify as Inter Regular, Inter Italic, DM Sans Regular and DM
Sans Italic and retain their copyright metadata. Both licence files are SIL Open Font License 1.1,
one for "The Inter Project Authors", one for "The DM Sans Project Authors", and neither declares a
Reserved Font Name after the copyright notice, so the bundled subsets may keep those family names.
No F37 font is present. `app/globals.css` loads all four faces from local `/fonts/` URLs; there is
no `@import`, no `fonts.googleapis.com`, no external stylesheet and no external script.
`app/layout.tsx` adds no `<script>` and no `<link>`. The only two external URLs in `app/` outside
`app/api` are a `<code>https://example.com</code>` example in help text and the pre-existing Stripe
Connected Account Agreement anchor, both already present at `e110a7c`. All six font files return 200
from the deployment with the expected byte counts.

**Provenance.** All 33 hashes in `docs/handoffs/ui-main-source-manifest.json` independently match
the merged tree at `856e75c`. The four font binaries and the three illustrations are hashed in
`ui-02-fonts.json`, `ui-01-artwork.json` and `ui-02-artwork.json`, and those hashes match too. The
two OFL text files are hashed nowhere; I read them instead.

**lucide-react.** `package.json` declares `"lucide-react": "^1.43.0"`. The lockfile pins 1.43.0 from
the npm registry with an integrity hash and an ISC licence. Because Vercel builds with `npm ci`,
which installs the lockfile exactly, the deployed build is deterministic. The caret is nonetheless
the only non-exact range in a file where `next`, `react`, `react-dom`, `postgres` and
`@react-pdf/renderer` are all exact. See F-UI-06.

## 3. Every page on production

I signed in over HTTPS as `ops@example.com`, `approver@example.com`, `broker@example.com` and
`customer2@example.com`, reading `DEMO_PASSWORD` from the local `.env.local` inside a script so the
value was never printed, echoed or written anywhere. All four logins returned 303 with a session
cookie. The login route only reads the `users` table and signs a cookie, so this review wrote
nothing to the database and made no provider call.

Every route present in `app/**` was requested with a real session. All returned HTTP 200 and
rendered their own `h1`, with no error boundary and no not-found body.

| Role | Routes | Result |
|---|---|---|
| `ops@example.com` | `/`, `/ops`, `/ops/policies`, `/ops/brokers`, `/ops/claims`, `/ops/claims/{id}`, `/ops/approvals`, `/ops/reconciliation`, `/ops/statements`, `/statements/{id}`, `/policies/{id}` | 11 of 11 at 200, headings "Your operations.", "Your policies.", "Brokers & verification.", "Track your claims.", "Claim CLM-00212", "Money-out approvals", "Reconciliation", "Broker statements", "Redwood Commercial Brokers, 2026-09", "Policy CGP-01274" |
| `approver@example.com` | `/ops`, `/ops/approvals`, `/ops/claims/{id}` | 3 of 3 at 200 |
| `broker@example.com` | `/broker`, `/broker/kyb`, `/broker/policies/new`, `/broker/statements`, `/policies/{id}`, `/policies/{id}/endorse`, `/policies/{id}/corrections/new` | 7 of 7 at 200. `/policies/{id}/cancel` without a date answers 307 to the policy with `error=pick a cancellation date first`, which is main's own behaviour and not a dressing change |
| `customer2@example.com` | `/customer` | 200, heading "Your policies" |

### Refusals

| Case | Measured |
|---|---|
| Broker on `/ops`, `/ops/approvals`, `/ops/policies` | 307 to `/broker` |
| Broker on `/customer` | 307 to `/broker` |
| Anonymous on `/ops`, `/broker`, `/customer`, `/policies/{id}`, `/ops/claims/{id}`, `/broker/statements` | 307 to `/login` |
| Staff on `/policies/not-a-uuid`, `/ops/claims/not-a-uuid`, `/statements/not-a-uuid` | 404 |
| Staff on an unknown but well-formed policy uuid | 404 |
| Unknown path | 404 |

### The loading boundary, reproduced and confirmed fixed

The reviewed revision `856e75c` contains `app/loading.tsx`, a root loading boundary that main never
had before the dressing (its only two commits are `bbf9c8b`, the UI-04 commit, and `af08635`, the
removal). I reproduced its effect independently, outside the repository: I exported `856e75c` to a
scratch directory, built it with Next 16.3.4 and started it with unreachable database placeholders.
Anonymous requests to `/ops`, `/broker`, `/customer`, `/policies/not-a-uuid` and
`/ops/claims/not-a-uuid` all answered **HTTP 200**, serving a 6 KB shell whose body is
"Loading your workspace" and whose RSC payload carries `REDIRECT;replace;/login;307;`. I searched
that payload for operations content and found none, so the coordinator's "no data leaked" is
correct. I then deleted `app/loading.tsx` in the same scratch copy, rebuilt, and the same six
requests answered 307 and 404. The defect and the fix are both confirmed by measurement.

Consequences while it was live: an external check of the deployed URL sees 200 for every protected
page, which misstates the access control in AF-01 evidence; and a client without JavaScript never
leaves the loading shell. It is recorded as F-UI-01 below and as F-UI-00 in `docs/reviews/FINDINGS.md`.
I agree with the coordinator's MEDIUM rating: the defect is in the honesty of the HTTP behaviour and
in the curl evidence a panel would gather, not in data exposure. I re-ran the fifteen refusal cases
against the later deployed revision `c9064d8` and they answer 307 and 404 exactly as tabulated
above, so the fix holds on the revision now serving.

### 375 pixel viewport

A headless browser was not required but was available, so I used one. I drove Chrome 152 over the
DevTools Protocol with a 375 by 812 viewport, `mobile: true`, `deviceScaleFactor: 2`, injecting the
session cookie for each role. For every route I measured `document.documentElement.scrollWidth`
against `window.innerWidth` and listed any element extending past the viewport that is not inside an
`overflow-x` container.

All 21 route and role combinations measured `docWidth == 375`, no overflow and no offending element:
the ten staff routes, the seven broker routes, `/customer`, `/ops/approvals` as approver, and both
not-found paths. The public home and login measured the same. I also captured and visually inspected
`/ops` at 375 and `/policies/{id}` at 1440: the sidebar stacks above the content on mobile, the
breadcrumb reads "Overview > Policies > Policy CGP-01274" on desktop, and the money tables render
server-side with the tax and fee formula lines intact.

The error boundary was not triggered on production, because doing so safely is not possible from
outside. I read `app/error.tsx` and confirmed it renders a styled page with a retry button and a
workspace link, and I confirmed on the local build that a deliberately missing `DATABASE_URL_APP`
fails closed at module load with a bare 500 rather than reaching the boundary. That refusal is
`db/client.ts`'s intended F-B1-02 behaviour, not a boundary defect: a database that is configured
but down throws inside the render, where the boundary does apply.

## 4. AF-06 readability

`WorkspaceOverview` is plain presentational JSX with one boolean prop and no logic beyond two
ternaries choosing the approver wording. Yoann can defend it as written.

`PortalFrame` is 74 lines with one piece of state. Defensible.

`PortalShell` is defensible in shape but not in style. Lines 60 to 98 chain a three-level nested
ternary for the navigation list and then derive `sectionLabel`, `root`, `isRoot`, `breadcrumbs` and
`roleLabel` through four more nested conditionals. The behaviour is simple; the expression of it is
not. See F-UI-08.

`app/globals.css` is the weak point. It went from 144 lines to 1060 lines and 160 selectors with two
comment headers in the whole file, and four breakpoints at 1100, 800, 600 and 580 pixels, the last
two in blocks appended after the main responsive section rather than merged into it. This is the
file a panel is most likely to open and the file Yoann is least equipped to walk line by line. See
F-UI-07.

The three places the panel will point at, and the sentence for each:

1. **`components/portal-frame.tsx:20` and `:30`.** The only decision the browser makes in this whole
   interface is whether the sidebar is visible; the server sends the sidebar and the page already
   rendered, so no session, no user object and no database client ever crosses into the browser.
2. **`components/portal-shell.tsx:84` to `:90`.** The shell picks the breadcrumb root and the role
   label from the signed-in user's role alone, purely to draw navigation, and every page still runs
   its own role and ownership check on the server before it renders, which is why a broker asking
   for `/ops` gets a redirect and not a page.
3. **`app/globals.css:691` (`.table-scroll`) with the breakpoints at `:862`, `:880` and `:938`.**
   Wide money tables scroll inside their own bordered region instead of widening the page, which is
   why every screen measures exactly 375 pixels wide on a phone with no horizontal scrolling.

Walkthrough status: **NOT REVIEWED WITH YOANN**. Nothing in this section certifies his
understanding; it records what I judge to be explainable and what is not.

## 5. The six DECISIONS entries

| Timestamp | Header label | My reading |
|---|---|---|
| 14:08:52 | User request and assistant implementation choice | Honest. Yoann's part (adapt the reference, no clicks on it, dedicated branch, Spark for the artwork) and the assistant's part (plain CSS, presentational shell, no backend change) are separated correctly. |
| 14:58:42 | User decision | Header overclaims. Yoann supplied the reference URL, allowed navigation and granted UI discretion; the substantive visual choices are labelled "Assistant choice" in the body. The body is honest and the header is not. |
| 15:34:02 | User refinement and assistant font choice | Honest, and the best of the six. It names the font selection as the assistant's, states DM Sans is an approximation of F37 Bolton and records the contrast ratios as limitations rather than a WCAG pass. |
| 15:59:44 | User navigation correction | Honest. Yoann reported the breadcrumb problem and asked for back arrows; the server-rendered trail is the assistant's design. |
| 16:43:46 | (no attribution field at all) | The one that most needs Yoann's confirmation. Its opening sentence bundles a real instruction, remove the intrusive preview banner and role strip, with a specific implementation, "a discreet Sandbox indicator", which is the collapsed control behind F-UI-02. Ask him which half he actually decided. |
| 18:04:17 | User instruction | Honest process record of the merge instruction and of who owns what afterwards. |

Two further observations for the coordinator. The 16:43 entry silently reverses the 15:59 decision
on back arrows without marking it superseded, unlike the business entries which say so explicitly.
And none of the six records the removal of the sandbox and trial statements from the home and login
pages or of the append-only sentence from the operations home, which are exactly the presentation
choices F-UI-02 and F-UI-03 are about.

The six entries live in `docs/DECISIONS.md`, a shared file that `AGENTS.md` reserves for the
coordinator. The coordinator's 18:11Z STATUS entry acknowledges and keeps them, so I treat the
ownership as accepted rather than as a violation.

## Findings

| ID | Severity | Finding |
|---|---|---|
| F-UI-01 | MEDIUM | The root `app/loading.tsx` added by the dressing turned every protected-page redirect into HTTP 200 and every malformed-id 404 into HTTP 200, with the real outcome only inside the RSC payload. Reproduced independently at `856e75c`; removed at `af08635`; refusals verified correct on production. Already tracked as F-UI-00. |
| F-UI-02 | MEDIUM | The public home and login pages lost every visible sandbox statement. `app/page.tsx` no longer says "Work trial build, Track 1. Sandbox providers and synthetic data only." or "Payments run on Stripe in test mode: no real card, no real money.", and `app/login/page.tsx` no longer says "Track 1 work trial build. Sandbox providers and synthetic data only." The only app-level disclosure left is a `<details>` with no `open` attribute whose visible summary is the single word "Sandbox". |
| F-UI-03 | LOW | The operations home lost its visible append-only sentence ("Every screen here reads append-only tables; nothing on these pages edits or deletes a money row. Corrections are reversals plus re-bookings"). On the deployed `/ops` the words "append-only" now appear only in the invisible `<meta name="description">`. |
| F-UI-04 | LOW | 17 of the 37 scrollable table regions carry auto-numbered accessible names ("Policy details table 1" to "5", "Statements table 1" to "4", "Reconciliation table 1" to "3", "Policies table 1" and "2") instead of contextual ones, so UI-04 finding F05 is only partly fixed despite that review recording F01 to F07 as confirmed. |
| F-UI-05 | LOW | `public/illustrations/corgi-desk.webp` and `corgi-landscape.webp` (31.7 KB together) are referenced by no page yet are shipped and publicly served, both returning 200 from the deployment. |
| F-UI-06 | LOW | `lucide-react` is declared as `^1.43.0` while every other dependency in `package.json` is exact-pinned. Deterministic in practice because Vercel builds with `npm ci` against the lockfile, which pins 1.43.0. |
| F-UI-07 | LOW | `app/globals.css` grew from 144 to 1060 lines and 160 selectors with two comment headers and four breakpoints (1100, 800, 600, 580), two of them appended after the main responsive block. AF-06 risk on the file a panel is most likely to open. |
| F-UI-08 | LOW | `components/portal-shell.tsx:60-98` derives the navigation list and five display values through nested ternaries up to three levels deep; `app/policies/[policyId]/correction-sections.tsx` has five `<table>` openings left unindented at column 0 by the wrapper insertion. AF-06 risk, no behaviour defect. |
| F-UI-09 | LOW | The merge added four `"peer": true` markers to `package-lock.json` on `@types/node`, `@types/react`, `react` and `react-dom`. At the start of this review the working tree carried an uncommitted modification removing them again, evidence that two npm runs on this repository disagree about those markers. The modification was gone by the end of the review and no commit since `856e75c` has touched the lockfile, so the committed file is consistent; the churn is worth one line and no more. |
| F-UI-10 | LOW | `docs/DECISIONS.md` is no longer chronological: the six interface entries (14:08 to 18:04) sit as a block after the business entries that end at 16:53. Entry 14:58 is headed "User decision" although its body attributes the visual choices to the assistant, and entry 16:43 carries no attribution field at all. |
| F-UI-11 | LOW | `/login` renders inside `PortalShell`, so a signed-out visitor is shown workspace chrome: the brand block, an "Insurance" section label, a two-item sidebar, a breadcrumb bar and, most awkwardly, an account block with a person avatar reading "Corgi workspace / Policy administration" for a visitor who has no account. Raised by Yoann. The relayed detail that the sidebar shows the seven staff destinations does **not** reproduce, and I could not produce it by any path I tried. |

### Evidence and required corrections

**F-UI-01.** Trigger: any anonymous request to a protected page, or any malformed id, at `856e75c`.
Evidence: isolated build of `856e75c` served locally, six requests at HTTP 200 with a
"Loading your workspace" shell; same build with `app/loading.tsx` deleted, the same six requests at
307 and 404; production at `af08635` measured at 307 and 404 for fifteen refusal cases. No
correction outstanding. Keep the boundary out unless a per-segment `loading.tsx` is added below the
routes that redirect.

**F-UI-02.** Trigger: open the deployed URL as the panel will. Evidence: the rendered home page at
1440 pixels shows only a grey 11-pixel "Sandbox" label in the top right; grep of the served HTML
finds no "work trial", no "Track 1", no "synthetic data", no "test mode"; the served markup is
`<details class="environment-badge">` with no `open` attribute, and `app/globals.css:1043` positions
its content as a popover. Consequence: the first page a reviewer sees reads as a live insurance
product. Required correction: one visible sentence on `/` and `/login` naming the build as a
sandbox work-trial build with no real money, or open the disclosure by default. I do not classify
this as an AF-02 violation: no integration is presented as live, every per-slot label survives at
its point of use, and the README inventory is unchanged. It is a material weakening of the
submission's honesty presentation and should be corrected before handover.

**F-UI-03.** Required correction: restore one sentence on `/ops` stating that these screens read
append-only tables and that corrections are reversals plus re-bookings, which is the single clearest
AF-03 statement the operator ever sees.

**F-UI-04.** Locations and counts: `app/policies/[policyId]/correction-sections.tsx` 5,
`app/statements/[runId]/page.tsx` 4, `app/ops/reconciliation/page.tsx` 3,
`app/policies/[policyId]/corrections/new/page.tsx` 2, and one each in
`app/policies/[policyId]/page.tsx`, `app/policies/[policyId]/endorse/page.tsx`,
`app/policies/[policyId]/corrections/[rebookEventId]/approve/page.tsx`,
`app/ops/statements/page.tsx`, `app/customer/page.tsx` and `app/broker/statements/page.tsx`. The
names are unique within each page, so this is not a blocking defect. Required correction: name each region after the heading above it, as the
twenty good ones already do ("Policy journal", "Reserve history", "Refund allocation").

**F-UI-09.** Evidence: `git status` reported a modified `package-lock.json` removing four
`"peer": true` markers when this review started, and reported a clean lockfile at the end, with no
commit in between touching the file. Required correction: none beyond noting the npm version that
produced the committed lockfile, so a reviewer starting from a clean clone can tell an expected
rewrite from a real drift.

**F-UI-11, tested rather than accepted.** The coordinator relayed Yoann's observation that the
login page shows a workspace sidebar with links to Overview, Policies, Brokers, Claims, Approvals,
Reconciliation and Statements while the visitor is anonymous. I could not reproduce the seven-link
part and I believe it does not occur. `components/portal-shell.tsx:34-81` selects the navigation
from the `user` prop, and `app/login/page.tsx:16` renders `<PortalShell active="login">` with no
`user`, so the anonymous branch at lines 78 to 81 supplies exactly two links. Measured three ways on
the deployed application:

- Anonymous `GET /login`: the rendered `nav[aria-label="Main navigation"]` contains `/` Overview and
  `/login` Sign in, nothing else.
- The real sign-out path driven in Chrome 152: signed in as `ops@example.com`, `/ops` shows the
  seven staff links, the account block "Sam Patel, operations / Staff operations" and a sign-out
  form; clicking sign-out lands on `/login` with two links, the placeholder account block and no
  sign-out form. No staff destination survives the transition.
- A staff cookie on `GET /login` answers 307 to `/ops`, so a signed-in staff user never renders that
  page at all.

What does render, and what I take the objection to be about, is visible in the desktop capture: the
sign-in page sits inside the portal chrome, with the brand block, an "Insurance" section label, a
sidebar, a breadcrumb reading "Overview > Sign in", the sidebar collapse toggle, and an account
block showing a person avatar above the words "Corgi workspace / Policy administration" for a
visitor who has no account. That last element is the weakest part: it presents an identity that does
not exist. Expected fix, and the one I would make: render `/` and `/login` in a bare layout without
`PortalShell`, or give `PortalShell` a signed-out mode that drops the account block, the section
label and the breadcrumb and keeps only the brand. Severity LOW: no authorisation issue, no data
exposure, both anonymous links are public pages, and it is a product-judgment defect rather than a
functional one.

**Main moved during this review.** At startup `HEAD` was `7170471`; by the end it was `9809b0e`
(loading-boundary removal, B4 and B8 finding merges, the PDF visual pass). None of those commits
touched `app/`, `components/`, `public/` or the lockfile except the `app/loading.tsx` deletion
already covered by F-UI-01. This verdict is issued for `856e75c` as instructed and holds for the
interface files as they stand at `9809b0e`.

## Checks actually executed

- `git diff` scope and attribution checks against `e110a7c`, `bfa2dca` and `856e75c` as described above.
- Independent form-contract extraction over all `app/` and `components/` sources in both revisions.
- Independent guard-line and pre-render-block comparison over all 24 changed page files.
- Independent verification of all 33 hashes in `ui-main-source-manifest.json` against the merged tree, plus the seven asset hashes in the artwork and font provenance files.
- `gitleaks 8.30.1` on the range `e110a7c..856e75c` (no leaks) and a full working-tree scan with every one of its 212 findings classified as untracked and ignored.
- fontTools 4.60.1 decode of all four WOFF2 files; full read of both OFL texts.
- Visual inspection of all three illustrations.
- Isolated production build of `856e75c` and of `856e75c` minus `app/loading.tsx`, each served locally, for the loading-boundary reproduction. Both builds compiled and generated their pages.
- Production sweep at `af08635`: four role logins, 22 authenticated page requests, 15 refusal cases, 6 static asset requests, all measured for status, redirect target and rendered heading.
- Chrome 152 over the DevTools Protocol at 375 by 812 with mobile emulation: overflow measurement on 21 route and role combinations; two screenshots inspected.

## Checks not executed, and why

- No unit, typecheck or build run on the repository itself. The business code is unchanged in this scope and the coordinator recorded typecheck, build and 370 tests (369 pass, 1 skipped) on the merged tree. My isolated builds cover the reviewed revision's compilability.
- No database write, no migration, no Stripe or provider call, no MCP action, no commit, no push, no deployment.
- No ledger, money-guard, webhook, reconciliation or approval test rerun. Those belong to the B1 to B10 reviews and are outside a presentation diff.
- The error boundary was not triggered on the deployed application; forcing a server error there is not a safe read-only action.
- No WCAG conformance assessment. The contrast defects recorded as UI02-C01 (white on `#ff5c00` at 3.096 to 1, orange heading on the grey workspace at 2.865 to 1) stand as disclosed limitations of Yoann's chosen reference colours. I did not recompute them and I make no accessibility pass claim.
- No keyboard conformance claim. The Enter-activation gap disclosed as UI02-L01 was not retested.
- The PDF visual pass is a separate delegate's work and is not covered here.

## Automatic-fail mapping for this scope

| Gate | Result in this scope |
|---|---|
| AF-01 accessible deployed URL | PASS at `af086358`. Every route renders for every role, refusals answer 307 and 404. The reviewed revision itself would have failed the status half of this evidence (F-UI-01). |
| AF-02 honest integration modes | PASS. Every per-slot label survives and renders on production. F-UI-02 records a weakened app-level disclosure, not a simulation presented as live. |
| AF-03 no UPDATE or DELETE on money rows | PASS for this scope: no `lib`, `db`, `scripts` or `app/api` change, no SQL, no money expression touched. Runtime ledger guards were not rerun here. |
| AF-04 sandbox only, no real data | PASS. Synthetic identities, `example.com` addresses, generated artwork with no person or company, no provider call and no spend by this review. |
| AF-05 no committed secrets | PASS. Clean range scan, zero findings in tracked files, `.env.local` ignored. The coordinator still owns the final staged and history scan before submission. |
| AF-06 own and understand every line | Explainability assessed, not certified. F-UI-07 and F-UI-08 name the two places that will be hardest to defend. **NOT REVIEWED WITH YOANN.** |

## Verdict and residual limitations

**PASS** for the interface dressing merged at `856e75c`, on the evidence above. The dressing is
presentation only: no business logic, no form contract, no server check and no money path changed,
and every page renders for every role on the deployed URL with correct refusals.

Two conditions attach. F-UI-01 was a real defect of the reviewed revision and this PASS relies on
its removal at `af08635`; do not reintroduce a root loading boundary. F-UI-02 remains open and
should be corrected before handover.

This review covers presentation, access-check preservation and asset provenance. It does not
approve the ledger, the provider integrations, the approval queue, reconciliation, statements, the
PDF output or the integrated trial gate, all of which keep their own records. It is an engineering
assessment, not a legal certification and not a guarantee of zero defects. Candidate walkthrough:
**NOT REVIEWED WITH YOANN**.
