# Independent review: evening UI batch, round 1

**Scope.** The five merged slices of the `ui-evening` branch: the sidebar and the ledger route
move, the inbox All view, the page band, the brand (PDF wordmark, favicon, sidebar mark, new-tab
document links), and the claim that the statement content hash is unaffected by the PDF change.
Presentation only, plus two generated modules and two asset scripts.

**Reviewer.** Independent reviewer sub-agent, own worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/agent-a13b18e1a5da2d475`.

**Revision reviewed.** `ui-evening` head **c120944** (which already contains `origin/main`
524488f), merged into the reviewer worktree with `git merge ui-evening`. Working tree clean apart
from this file. `origin/main` = **524488f**, used throughout as the before picture.

**Timestamp.** 2026-09-09, 19:20Z to 21:05Z (Europe/Zurich evening).

**Verdict: PASS.** Every claim the batch makes is supported by evidence below. Four LOW findings
are opened, one of them (F-EV-03) inside the batch's own diff, three outside the money path. Two
defects found while probing are reproduced identically on `origin/main` and are therefore recorded
as pre-existing, not as regressions of this batch. The known breadcrumb finding F-EV-01 is
confirmed and refined.

---

## 0. Startup receipt

Read in full, in this order, in this session: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `REVIEWER.md`,
`AGENTS.md`, `WORKFLOW-48H.md`, `READABLE-CODE.md`. Read for scope: `docs/reviews/ui-system.md`
section 3.5 (the 30 figures), `docs/reviews/b13-13-ui-audit.md` (F-UA-01, the figure method),
`docs/reviews/b13-11-observability.md` (the `withActivity` inventory), `docs/reviews/FINDINGS.md`
(searched for the badge and the band), `docs/STATUS.md` (searched, not read end to end),
`app/layout.tsx` (the no-`loading.tsx` record).

Absent files: none of the mandatory kit is missing.

Reviewed object: the diff `origin/main...ui-evening`, 68 files, +997 / -719.

Checks planned and run: listed in section 8, with the ones not run and why.

Nothing was written to the trial database. Every page read was a `GET`; the only `POST` issued was
`/api/session/login`, which the assignment authorises and which writes an activity row and no money
row. `DEMO_PASSWORD` was read from the main checkout's `.env.local` by script and never printed.

---

## 1. Non-negotiables

### 1.1 What the diff touches

```
$ git diff origin/main...ui-evening --stat | tail -1
 68 files changed, 997 insertions(+), 719 deletions(-)

$ git diff origin/main...ui-evening --name-only | grep -E '^(lib/|db/|app/api/|scripts/)'
lib/documents/brand-wordmark.ts
lib/documents/pdf-theme.ts
lib/documents/render.tsx
lib/statements/pdf.tsx
scripts/brand-assets.mjs
scripts/crop-band-illustrations.mjs
```

**Nothing under `db/`. Nothing under `app/api/`.** The four `lib/` files are the two policy
documents, the statement PDF and the shared PDF theme; all four were read line by line (section 5).
The two scripts are new build-time tools, not runtime code.

```
$ git diff origin/main...ui-evening -- lib db app/api | grep -nE '^\+.*(UPDATE |DELETE |INSERT |sql`|query\(|db\.)'
(none)
```

No SQL of any kind is added under `lib/`, `db/` or `app/api/`.

### 1.2 UPDATE / DELETE

```
$ git diff origin/main...ui-evening | grep -nE '^\+.*\b(UPDATE|DELETE|TRUNCATE|DROP)\b'
894:+// role that has no UPDATE or DELETE on the journal. There is no form on this page that posts.
```

The single hit is a comment in `app/ops/ledger/page.tsx` restating the AF-03 guarantee, carried over
verbatim from the file the route was moved from. **AF-03: no money row is written, updated or
deleted anywhere in this diff.**

### 1.3 Secrets

```
$ gitleaks detect --source . --log-opts="origin/main..ui-evening" -v
12 commits scanned. scanned ~188598 bytes (188.60 KB) in 163ms
no leaks found
```

`.env.local` was copied into the worktree for the dev server and is gitignored; `git status` is
clean of it. The new `brand/` directory holds two flat-colour logo JPEGs and a README; no
credential, no personal data, no real person in any image. **AF-05: PASS for this range.**

### 1.4 Dashes

```
$ git diff origin/main...ui-evening | grep -nP '^\+.*[\x{2013}\x{2014}]'
(none)
```

Zero em dashes and zero en dashes in the added lines. Independently, the rendered text of 63
screen states at 1440, 1280 and 1024 px was scanned for the two characters in `document.body.innerText`:
**0 occurrences on every state** (section 6).

### 1.5 No `loading.tsx`

```
$ find app -name 'loading.*'
(no output)
```

None in the diff and none in the tree. `app/layout.tsx:5-26` still carries the measurement that
explains why, and the batch did not weaken it.

---

## 2. Forms

```
$ git diff origin/main...ui-evening | grep -E '^[-+].*(action=|method=|name=")'
-            action={
+            action={
-    <form method="get" action={`/api/policies/${policyId}/documents/${endpoint}`} className="pd-doc-row">
+      method="get"
+      action={`/api/policies/${policyId}/documents/${endpoint}`}
```

Five lines, and every one of them accounted for:

| Line | What it is | Verdict |
|---|---|---|
| 1, 2 | `action={` on the `EmptyState` **React prop** of the ledger page, not an HTML form; it appears once as removed and once as added only because the file moved from `app/ops/console/ledger/page.tsx` to `app/ops/ledger/page.tsx` | not a form |
| 3, 4, 5 | `DocumentRow` in `app/policies/[policyId]/correction-sections.tsx:148`: the one-line `<form method="get" action=...>` was reformatted across four lines to take `target="_blank"` | **same method, same action, same field name** |

The `asOf` input inside that form is unchanged (`app/policies/[policyId]/correction-sections.tsx:151-160`:
`name="asOf"`, `type="date"`, `min={termStart}`, `required`). Read in context with `-U10`, the
only added attribute on the form is `target="_blank"`.

**No `action=`, no `method=` and no `name="…"` value changed anywhere in the batch.**

Every PDF anchor was then enumerated rather than trusted:

```
$ grep -rn --include='*.tsx' -E 'href=.*(documents/|/pdf)' app components | grep -v '^app/api'
app/broker/statements/page.tsx:194
app/policies/[policyId]/correction-sections.tsx:565
app/policies/[policyId]/correction-sections.tsx:573
app/statements/[runId]/page.tsx:182
app/customer/page.tsx:230
app/customer/page.tsx:237
```

Five anchors, and all five carry `target="_blank" rel="noopener"` (read in place). Plus the one
GET form, which carries `target="_blank"`. That is the full population: six ways to reach a
generated document, six of them opening beside the page. **Claim 4 supported.**

---

## 3. AF-02: the mode line and the sandbox sentence

The exact string was extracted from the served HTML of each page, tags stripped:

| Page | Role | Status | Top bar |
|---|---|---|---|
| `/ops` | ops | 200 | `Stripe: LIVE SANDBOX · claim rail: LOCAL SIMULATOR · bank check: LOCAL SIMULATOR` |
| `/ops/ledger` | ops | 200 | identical |
| `/ops/console/search` | ops | 200 | identical |
| `/ops/console/infra` | ops | 200 | identical |
| `/policies/3c3697b7-…` | ops | 200 | identical |
| `/inbox` | ops | 200 | identical |
| `/ops/statements` | ops | 200 | identical |
| `/broker` | broker | 200 | identical |
| `/customer` | customer | 200 | identical |

Nine of nine, byte for byte, including the middle dots. Signed out:

| Page | Status | Sentence verbatim |
|---|---|---|
| `/` | 200 | `Work-trial build on sandbox providers and test data. No real money moves here.` **true** |
| `/login` | 200 | same sentence, **true** |

**AF-02 labelling: PASS. The ledger route move did not drop the mode line on the moved screen.**

Both PDFs also still carry the `TEST DATA, SANDBOX` chip and the issuer `Demo Insurer, work-trial
build` (section 5), so the brand change did not turn a demonstration document into something that
reads as a live carrier's.

---

## 4. Route move, refusals, the observability inventory

### 4.1 The redirect

```
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://localhost:3031/ops/console/ledger?view=flows"
307 http://localhost:3031/ops/ledger?view=flows

$ curl … "http://localhost:3031/ops/console/ledger"
307 http://localhost:3031/ops/ledger

$ curl … "http://localhost:3031/ops/console/ledger?view=entries&type=premium&inspect=abc"
307 http://localhost:3031/ops/ledger?view=entries&type=premium&inspect=abc
```

The whole query string survives, including a repeated parameter (`app/ops/console/ledger/page.tsx:14-19`
rebuilds it with `URLSearchParams.append`, keeping array values).

### 4.2 Which redirect a signed-out visitor gets first, and whether it leaks

| Request | Answer |
|---|---|
| `/ops/console/ledger?view=flows` **signed out** | `307 → /ops/ledger?view=flows` |
| `/ops/ledger` **signed out** | `307 → /login` |

So a signed-out visitor takes **two hops, ending at `/login`**, and the first hop is to
`/ops/ledger`, not to `/login`. That order is the deliberate one: the moved-route file answers
*before* any session read (`app/ops/console/ledger/page.tsx:1-11`, the comment says so).

**It leaks nothing.** Both `/ops/console/ledger` and `/ops/ledger` are public path strings that
the visitor already knew or guessed; the redirect is a pure function of the URL they sent, reads
no session, touches no database and returns no body. On `origin/main` the same request answered
`307 → /login` in one hop, so the observable difference is one extra public path name in a
`Location` header. No record identifier, no role, no existence answer.

### 4.3 The refusal matrix

| Request | Actor | Answer |
|---|---|---|
| `/ops/ledger` | signed out | `307 /login` |
| `/ops/ledger` | broker | `307 /broker` |
| `/ops/ledger` | customer | `307 /customer` |
| `/ops/ledger` | approver | `200` |
| `/ops/console/ledger?view=flows` | signed out | `307 /ops/ledger?view=flows` then `307 /login` |
| `/ops/console/ledger?view=flows` | ops | `307 /ops/ledger?view=flows` |
| `/ops/console/search` | signed out | `307 /login` |
| `/ops/console/infra` | broker | `307 /broker` |
| `/inbox` | signed out | `307 /login` |
| `/ops/mcp-keys` | approver | `307 /ops` |
| `/api/statements/<run>/pdf` | customer | `404` |
| `/api/statements/<run>/pdf` | broker, another broker's run | `404` (9 of 11 runs served, 2 refused) |

The approver `200` on `/ops/ledger` is **not** a widening: the moved page calls the same
`requireStaff()` as the file it replaced (`git show origin/main:app/ops/console/ledger/page.tsx:73`
against `app/ops/ledger/page.tsx:73`), and `lib/console/guard.ts` delegates to the pure
`consoleAccessFor(role)`, unchanged. The ledger is a read-only staff screen; the approver
separation that matters is `/ops/mcp-keys`, which still refuses them (F-INT-01).

### 4.4 `withActivity` inventory

```
                             origin/main    ui-evening
exported handlers under app/api      38            38
withActivity( wrappers               38            38
unwrapped exported handlers           0             0
```

**Unchanged by the batch.** The route move touched a page, not a route handler, so no handler
could have been dropped. Note for the record: `docs/reviews/b13-11-observability.md` records
**37**; the tree has held **38** since before this branch (`git grep withActivity origin/main`
returns 38), so the documented figure is stale relative to `origin/main` and is not a regression of
this batch. Not opened as a finding against `ui-evening`; the coordinator may want to refresh the
number.

### 4.5 Hostile URLs on the moved route

Measured on the **production build** (`next start`, port 3032), so the reported HTML is what a
reviewer of the deployment would get:

| URL | Status | Band title | Stack trace or filesystem path in the body |
|---|---|---|---|
| `/ops/ledger` | 200 | Account balances | no |
| `/ops/ledger?view=../..` | 200 | Account balances | no |
| `/ops/ledger?view=%2e%2e%2f%2e%2e` | 200 | Account balances | no |
| `/ops/ledger?view=nonsense` | 200 | Account balances | no |
| `/ops/ledger?view=<script>alert(1)</script>` | 200 | Account balances | no |
| `/ops/ledger?view=entries&asOf=not-a-date` | 200 | Entries | no |
| `/ops/ledger?view=flows&days=99999` | 200 | Flows by day | no |
| `/ops/ledger?view=account&account=`+400×`A` | 200 | One account | no |
| `/ops/ledger?view=entries&policy=not-a-uuid` | 200 | Entries | no |
| `/ops/ledger?view=entries&inspect=<img src=x onerror=…>` | 200 | Entries | no |
| `/ops/ledger?view=balances&view=entries` (repeated) | 200 | Account balances | no |
| `/ops/console/search?reference=`+400×`R` | 200 | Search + truncated reference | no |

Every unknown or hostile `view` falls back to the default `balances` through `pickView` against the
list the file owns (`app/ops/ledger/page.tsx:37`), a malformed date is dropped by `validDate`
(`:58-63`), a non-UUID by `validUuid` (`:65-68`), and a repeated parameter resolves through
`firstValue`. Nothing reaches a reader as raw input.

The 400-character reference in the top bar search: page holds at `scrollWidth == innerWidth == 1440`,
band stays 69 px, the suffix is truncated with an ellipsis by `.band-suffix { max-width: 34ch }`,
and the screen prints "Nothing matches. It was read as a shape this search does not recognise."
Screenshot `rev-focus/1440-search-400.png`.

---

## 5. The documents, the brand and the statement hash

### 5.1 What changed in `lib/`

`lib/documents/pdf-theme.ts`

- `PDF_COLOR.accent` moves from `#b83e00` to `#ff5c00` (`:66`), with the contrast reasoning written
  beside it: `#ff5c00` on white is about 2.9:1, which is a rule's contrast and not a name's.
- Consequently **`issuerName` moves from accent to ink** (`:229`) and **`sandboxLabel`'s text moves
  from accent to ink while its border keeps the accent** (`:236-238`). No text style in the file
  carries `#ff5c00` after the change; grep confirms accent survives only on `sandboxLabel.borderColor`,
  `titleBandAccentBar.backgroundColor` (`:254`) and a `borderLeftColor` (`:327`). That is a real
  accessibility improvement made in the same commit that introduced a brighter colour, and it is
  documented rather than silent.
- `corgiWordmarkPng()` (`:151-155`) decodes the base64 once per process and caches the `Buffer`.
  The comment explains the choice of a compiled-in module over `readFileSync(public/…)`: a file
  under `public/` is guaranteed to reach the CDN, not the serverless function. That reasoning is
  correct for Vercel and the safer of the two options.

`lib/documents/brand-wordmark.ts` is a 10-line generated constant module, marked
`GENERATED FILE, DO NOT EDIT BY HAND`, with its producer named.

`lib/documents/render.tsx` and `lib/statements/pdf.tsx` each add `Image` to the destructured
dynamic import and one `<Image style={styles.issuerLogo…} src={corgiWordmarkPng()} />` inside the
existing `issuerHeader`. **No figure, no date, no snapshot field and no line of the document body
is touched.** The comment at both policy call sites makes the AF-02 point explicitly: the wordmark
says which system produced the sheet, the issuer printed beside it is still not Corgi.

### 5.2 The documents, read

`/api/policies/3c3697b7-…/documents/declarations?asOf=2026-09-09` → 200, `application/pdf`, 78 780 bytes.
Read with the Read tool:

- orange Corgi wordmark, top left, crisp;
- issuer **`Demo Insurer, work-trial build`** in dark ink, tagline underneath;
- `TEST DATA, SANDBOX` chip in dark ink inside an orange border, top right;
- orange accent bar down the left of the grey title band;
- `SPECIMEN, TEST DATA` watermark intact;
- figures unchanged: `$1,200.00 / $28.20 / $25.00 / $1,253.20`, limits `$1,000,000.00` and
  `$2,000,000.00`.

`/api/statements/c602abcf-…/pdf` → 200, 84 490 bytes: same masthead, `Net due $429.56`, the content
hash `7eddb01ae791314713dc57eb69a11d07bbafc1f4926028417391d6af0919c78c` printed on the face of the
document, and `$180.00` on the commission lines.

### 5.3 The hash claim

`lib/statements/compute.ts:206-207`:

```ts
const canonicalText = canonicalTextOf(input, lines, totals);
return { lines, totals, canonicalText, contentHash: sha256Hex(canonicalText) };
```

`canonicalTextOf` (`:400`) takes the input, the lines and the totals. It has no parameter that
could carry a colour, a logo or a rendered byte, and `renderStatementPdf` is called only from
`app/api/statements/[runId]/pdf/route.ts:49` and `lib/documents/write-sample-documents.ts`, never
from the compute path. **Claim 5 supported: the PDF is rendered from the stored run at download
time and is not an input to any hash.** The determinism tests are in the suite that passed
(section 8), and the stored runs still render their "identical" chips on `/ops/statements`.

### 5.4 The marks

`app/icon.png` is byte-identical to `public/brand/corgi-mark.png`
(`da44480cfbf07a0ef43bfc35760e95712172f357`), 512×512 RGBA, served `200 image/png` from the
production build and listed `○ /icon.png (Static)` by `next build`. The sidebar mark is the same
shape as a CSS mask painted with `currentColor` (`app/styles/system.css:99-108`), so it is one file
for both themes; read at 3× zoom it is clean at 24 px (`crop-mark.png`). `components/signed-out-frame.tsx`
uses the same `.workspace-mark`, so the public pages carry the mark too.

`brand/README.md` documents the derivation honestly, including that `public/brand/corgi-logo.png`
currently has no reader.

---

## 6. Screens

63 states rendered and screenshotted at **1440, 1280 and 1024 px**: as ops `/ops`, `/ops/console`,
`/ops/ledger`, `/ops/ledger?view=entries`, `/ops/console/search`, `/ops/console/infra`, `/inbox`,
`/inbox?section=approvals`, `/ops/statements`, `/ops/brokers`, `/policies/3c3697b7-…`, the same
policy `?view=money`, `/policies/104d2966-…?view=claims`, `/statements/c602abcf-…`; as broker
`/broker`, `/broker/statements`, `/broker/kyb`; as customer `/customer`; signed out `/` and `/login`.
Each state was measured in the page, not eyeballed, then the images were read.

Measured on every one of the 63:

| Assertion | Result |
|---|---|
| `.band-meta` elements (a chip row under the title) | **0 on all 63** |
| chips inside `.band-status` | 0 or **1**, never 2 |
| `<details>`, `summary` or `.context-group` inside `.sidebar-views` | **0 on all 63** |
| a signed-in person's name inside `.page-band` | **0 on all 63** |
| em or en dash in `document.body.innerText` | **0 on all 63** |
| horizontal overflow (`scrollWidth > innerWidth`) | **none** |
| `.workspace-mark` present | **true on all 63**, signed out included |
| browser console error or page error | **none** |
| band height | **69 px** on 62 of 63 |

Title size, read from `getComputedStyle`: **28 px at 1440, 24 px at 1280, 24 px at 1024**, and
`22 px` below 800 from the stylesheet (`app/styles/system.css:2437` and `:2473`). Matches the claim.

Submenus, read from the DOM as a flat list of links with the chevron count:

| Screen | Submenu drawn | Chevrons in the whole sidebar |
|---|---|---|
| `/ops/ledger`, `?view=entries` | `Balances, Account, Entries, Flows` | 1 |
| `/ops/console` | `Feed, Problems4, Latency` | 1 |
| `/policies/…` (any view) | `Overview, Endorsements, Claims1, Money, Timeline` | 1 |
| `/broker/kyb` | `Status, Submit, History` | 1 |
| `/ops`, `/inbox`, `/ops/console/search`, `/ops/console/infra`, `/ops/statements`, `/ops/brokers`, `/statements/…`, `/broker`, `/broker/statements`, `/customer` | none | 0 |

**The chevron appears only on the entry whose submenu is open**, which is what
`components/shell/app-shell.tsx:170-171` computes (`submenuOpen = isHere && views?.length > 0`).
Search and Infrastructure are entries with no submenu, as claimed.

The sidebar itself, read from the 1440 ledger screenshot: **Work** = Overview, Inbox, Console,
**Ledger** (open, four indented links), **Search**; **Records** = Policies, Brokers, Claims;
**Money** = Approvals, Reconciliation, Statements; **System** = **Infrastructure**, MCP keys.
Infrastructure sits above MCP keys. **Claim 1 supported.**

Band vignettes: every one of the 13 sections in `components/shell/sections.tsx` names an
illustration that has a cropped 208×208 copy in `public/illustrations/band/` (13 files, 13
sections, checked name by name); no page passes a `band.illustration` override, so there is no
section that falls back to an uncropped library file. In the images the animal fills the 52 px
frame and the softened radial mask (`46%/72%` → `55%/85%`) shows no square edge.

**The folded rail.** Toggled, then the active icon hovered: the flyout opens over the content and
lists `Balances, Account, Entries, Flows`, 200×132 px, visible. Screenshot
`rev-focus/1440-rail-flyout.png`. **Claim 1's flyout supported.**

**The inbox.** On the All view the chips read `All 4 · Reconciliation 4 · Approvals 0 · Policies 0 ·
Endorsements 0 · Claims 0 · Statements 0`. Every section keeps a chip and its count including 0, and
and the only anchor id rendered is `reconciliation`, the one section holding work. Clicking the
`Approvals 0` chip opens `/inbox?section=approvals`, which draws **a card with an illustration and
the sentence "No money-out request is waiting for a decision.", with `id="approvals"` on the
wrapper**. Screenshot `rev-focus/1440-inbox-approvals-zero.png`. **Claim 2 supported.**

**The statements order.** Both lists sort by `createdAt` descending and by nothing else
(`app/ops/statements/page.tsx:64`, `app/broker/statements/page.tsx:66`). `/broker/statements`
gained a **Produced** column: headers read `Month, Produced, Revision, Commission, Net due, Status`.
`/ops/statements` has no Produced column but is not blind to its own sort key: the age is the
sub-line of the broker cell (`Primary … sub={<When instant={run.createdAt} …>}`, `:212`), so the
reader can see the order there too. **Claim 3's ordering supported.**

**Known: F-EV-01, the breadcrumb.** Measured rather than eyeballed, and compared with `origin/main`:

| Width | `ui-evening` | `origin/main` |
|---|---|---|
| 1440 | `Overview` clipped (55 of 58 px), `Policies` clipped (43 of 47), `Policy CGP-01707` clipped (102 of 109) | **identical** |
| 1280 | breadcrumb `display: none` | identical |
| 1024 | breadcrumb `display: none` | identical |

Recorded as known and already assigned, not counted as new. One refinement for the register: it is
hidden **from 1280 down**, not only at 1024 (`app/styles/system.css:2455`, inside
`@media (max-width: 1280px)`).

---

## 7. Scroll, 375 px, tests

### 7.1 The scroll rule

`components/shell/scroll-to-top.tsx`, read in full: a client component mounted once inside
`PortalFrame` in a `<Suspense>` boundary, effect keyed on `[pathname, view]`, with
`if (window.location.hash !== "") return;` as its first statement (`:25`). It moves nothing on a
change of `inspect`, a filter chip, or any parameter other than `view`.

`scrolltest5.mjs`, verbatim:

```
sidebar link to another route, expect top: /ops/reconciliation at scrollY 1500 -> click /ops/approvals -> scrollY 0 (now /ops/approvals) PASS
same route, ?view link, expect top: /ops/reconciliation at scrollY 1500 -> click /ops/reconciliation?view=breaks -> scrollY 0 (now /ops/reconciliation?view=breaks) PASS
ledger submenu link, expect top: /ops/ledger?view=entries at scrollY 1200 -> click /ops/ledger?view=flows -> scrollY 0 (now /ops/ledger?view=flows) PASS
hash link, expect the anchor, not the top: /ops/reconciliation at scrollY 1500 -> click /inbox#reconciliation -> scrollY 1500 (now /ops/reconciliation) FAIL
inspect only, expect the position kept: /ops/reconciliation at scrollY 1500 -> click /ops/reconciliation?inspect=pi_3UDSs4K6R3v50tIy05wKxRBA -> scrollY 711 (now /ops/reconciliation?inspect=pi_3UDSs4K6R3v50tIy05wKxRBA) PASS
filter chip, expect the position kept: NO a.chip-link inside the window at 700
```

`chiptest.mjs`, verbatim:

```
reconciliation filter chip, expect the position kept: /ops/reconciliation at scrollY 120 -> click /ops/reconciliation?source=stripe -> scrollY 120 (now /ops/reconciliation?source=stripe) PASS
```

`hashtest.mjs`, verbatim:

```
direct load /inbox#reconciliation: scrollY 0, the #reconciliation box is 191 px from the top of the window FAIL
direct load /inbox: scrollY 0
the badge box is {"x":214,"y":423.78125,"width":22,"height":22}, and the element at its centre is a.nav-badge href=/inbox#reconciliation
badge click: at scrollY 1500 -> scrollY 1500 (now /ops/reconciliation)
```

Four PASS, one "no chip in the window" that `chiptest.mjs` then covers with a PASS, and two lines
that read as failures. **Both were run down, and neither is a defect of this batch:**

- The `hashtest.mjs` FAIL is a **measurement artefact**. `/inbox` is exactly as tall as the
  viewport on the current data: `scrollHeight 900, innerHeight 900, scrollable 0`. A page that
  cannot scroll cannot report `scrollY > 0`, so the assertion can never pass there regardless of
  the guard. Opened as **F-EV-04** (evidence gap, not behaviour).
- The badge click that does not navigate is **reproduced identically on `origin/main`**. Opened as
  **F-EV-02** and recorded as pre-existing.

### 7.2 375 px

```
$ BASE=http://localhost:3031 ROLE=ops@example.com WIDTHS=375 OUT=review-375 \
  PATHS="/ops/console,/ops/ledger,/ops/reconciliation,/policies/3c3697b7-…,/inbox,/ops/statements" node break.mjs

FINDINGS (9):
- ops_console @375: BAND NOT STICKY top=564
- ops_ledger @375: BAND NOT STICKY top=594
- ops_reconciliation @375: BAND NOT STICKY top=594
- policies_3c3697b7-… @375 plain: BAND TOO TALL 153px
- policies_3c3697b7-… @375 folds open (9): BAND TOO TALL 153px
- policies_3c3697b7-… @375 inspector: BAND TOO TALL 153px
- policies_3c3697b7-… @375: BAND NOT STICKY top=624
- inbox @375: BAND NOT STICKY top=422
- ops_statements @375: BAND NOT STICKY top=422
```

**No `HORIZONTAL OVERFLOW` line on any of the 20 states.** All nine findings are `BAND NOT STICKY`
and `BAND TOO TALL`, which are the accepted static band under 800 px, F-UIS-09. Fold-open states
(46 folds on the console, 30 on the statements) hold too.

### 7.3 Checks

```
$ npm test          → tests 535, pass 534, fail 0, skipped 1, exit 0
$ npm run typecheck → exit 0, no output
$ npm run build     → exit 0; 34 routes, all ƒ (Dynamic) except ○ /icon.png (Static)
```

534 passing, as expected. The `<Suspense>` boundary around `ScrollToTop` does the job it is there
for: nothing that was prerendered stopped being prerendered.

### 7.4 The 30 figures

Every figure of `docs/reviews/ui-system.md` §3.5 re-read on this branch through an ops session,
against the flattened HTML of the view that owns it:

| Policy | Figures | Result |
|---|---|---|
| CGP-01707 | 1 to 4, 13 to 15, 17 (Overview) | `$1,200.00`, `$28.20`, `$25.00`, `$1,253.20`, `$2,380.44`, `$345.20`, `$2,301.36`, `$1,000,000.00`, `$2,000,000.00`: all present |
| CGP-01707 | 5 | `$180.00` present on `/statements/c602abcf-…` as **staff** and as the **broker** |
| CGP-01707 | 6, 7 | `335 of 365 days` and `$1,200.00` present on the Endorsements view |
| CGP-01707 | 8 to 12 | `$1,101.36`, `$25.88`, `$1,127.24`, `$165.20` present |
| CGP-01707 | 16 | `pi_3UDf5YK6R3v50tIy1GkJdCCi` present |
| CGP-01274 | 18 to 26 | `$2,312.00`, `$2,391.33`, `$278.70`, `$2,033.30`, `$47.79`, `$2,081.09`, `$304.99`, `$41.81` present on the Money view |
| CGP-01274 | 24 | `$2,081.09` present on `/ops/approvals?view=decided` |
| CGP-01274 | 27 to 29 | `$1,200.00`, `$3,800.00`, `$5,000.00` present on the Claims view |
| CGP-01274 | 30 | `re_3UDN8aK6R3v50tIy0J6CmRy3` present |

**30 of 30 agree. Nothing moved.** Figure 5 is on the statement run page rather than on the
`/ops/statements` list, which is where §3.5 always placed it ("both statement pages").

The ledger still ties:

```
/ops/ledger?view=balances → Total debits $44,627.30 / Total credits $44,627.30
```

(and `$46,935.62` on both sides an hour later, the trial database being written to by other work in
parallel. The point is that the two totals are equal at every reading).

---

## 8. Checks run, and checks not run

Run: `git diff --stat` and the full diff of every `lib/`, `db/`, `app/api/` and `scripts/` file;
`gitleaks` on the range; the dash grep on the diff and on 63 rendered states; the form-attribute
grep with `-U10` context; the PDF-anchor census; the AF-02 string extraction on 11 pages;
the refusal matrix (12 combinations, four roles plus anonymous); the redirect `curl`s; the
`withActivity` census on both revisions; 12 hostile URLs on the production build; the 30 figures;
63 screenshots at three widths with in-page measurement, all read; the folded rail flyout; a
400-character reference; a policy with no endorsement; `break.mjs` at 375 px; `scrolltest5.mjs`,
`hashtest.mjs`, `chiptest.mjs`; both PDFs fetched and read; `npm test`, `npm run typecheck`,
`npm run build`; and a full A/B against a clean extraction of `origin/main` served on its own port
to separate regressions from what was already there.

**Not run, and why:**

- **No write to the trial database of any kind**, so no statement re-run, no `npm run
  check:statements` and no `npm run check:money-guards`. The hash claim is established by reading
  `lib/statements/compute.ts` and by the determinism tests inside the suite that passed. A re-run
  would be a write and is outside a read-only mandate.
- **No deployed-URL check.** This review is of a branch on a local dev server and a local
  production build; AF-01 evidence for the deployment is the coordinator's, and is recorded as
  **NOT RUN** here rather than assumed.
- **No accessibility audit and no cross-browser pass.** One engine (Chromium headless) at three
  widths plus 375 px. The `#ff5c00` contrast question is answered by reading the styles, not by an
  automated checker.
- **No review of the money paths, the ledger reads or the guards**, which this batch does not
  touch and whose prior evidence stands unchanged.

---

## 9. Findings

| ID | Severity | Finding |
|---|---|---|
| F-EV-01 | known | The breadcrumb, already assigned. Confirmed here, identical on `origin/main`. |
| F-EV-02 | MEDIUM | **Pre-existing.** Every sidebar count badge is a dead link. |
| F-EV-03 | LOW | Two new npm scripts import `sharp`, which the repository does not declare. |
| F-EV-04 | LOW | The hash-anchor guarantee has no working runtime proof on the current data. |
| F-EV-05 | LOW | At 1024 px the statement run band is two lines, 90 px, not the one line claimed. |
| F-EV-06 | LOW | **Pre-existing.** The policy Endorsements view draws its headers over an empty state. |
| F-EV-07 | LOW | The one document GET form takes `target="_blank"` without `rel="noopener"`. |

### F-EV-01, the breadcrumb (known, already assigned)

Recorded, not counted as new. **Refinement:** it is hidden from **1280 px** down, not only at 1024.
`app/styles/system.css:2455`, inside `@media (max-width: 1280px)`. At 1440 three items are clipped:
`Overview` 55/58 px, `Policies` 43/47 px, `Policy CGP-01707` 102/109 px, so a policy number is cut
mid-token. Identical on `origin/main`, so this batch neither caused it nor made it worse.

### F-EV-02, MEDIUM, pre-existing: the sidebar count badges do not navigate

**Location:** `components/shell/app-shell.tsx:188-191` (the `<Link className="nav-badge">`),
`app/styles/system.css:177-199`. **Neither is touched by this batch**
(`git diff origin/main...ui-evening | grep nav-badge` is empty).

**Trigger.** Sign in as `ops@example.com`, go to `/ops/reconciliation`, click the orange `4` badge
beside Reconciliation, or beside Inbox.

**What happens.** Nothing. The URL stays on the page you were on.

```
badge WITHOUT a hash: from /ops/reconciliation, href /inbox              -> url /ops/reconciliation
badge WITH a hash:    from /ops/reconciliation, href /inbox#reconciliation -> url /ops/reconciliation
plain sidebar link (control): href /ops/approvals                        -> url /ops/approvals
hard load /inbox#reconciliation                                          -> /inbox#reconciliation
```

Reproduced with a real mouse click, with `Enter` on the focused anchor, and with a synthetic
`.click()`. The event does reach the anchor and is not intercepted by anything above it:

```
capture phase: {defaultPrevented: false, target: "A.nav-badge",
                path: ["a.nav-badge","div.sidebar-nav-line","div.sidebar-nav-row","div."]}
bubble  phase: {defaultPrevented: true}
```

so Next's `Link` handler calls `preventDefault()` and then no navigation follows. No console error,
no page error. **Reproduced on the dev server (3031), on the production build (`next start`, 3032)
and on a clean extraction of `origin/main` 524488f served on port 3033.** It is therefore
pre-existing and outside this batch's scope; it is reported because the batch's own `hashtest.mjs`
exercises this link and prints a line that reads like a batch failure, and because a count that
cannot be opened is exactly the complaint the inbox was built to answer.

**Consequence.** Every count badge in the sidebar, for every role, is decorative. A hard reload of
the same URL works, so nothing is unreachable, only unclickable.

**Required correction (for the owner of the shell, not for this batch).** Diagnose the `Link`
inside `.sidebar-nav-line`; the cheapest safe fix is a plain `<a href>` for the badge, since it
carries no client state and a full navigation is acceptable for it.

*Register line:* `F-EV-02 | MED | Pre-existing at origin/main 524488f: every sidebar count badge (a.nav-badge) is a dead link. A real click and Enter both leave the URL unchanged in dev and in the production build, while a hard load of the same href works; the click reaches the anchor and is defaultPrevented with no navigation | Make the badge a plain <a href> or fix the Link inside .sidebar-nav-line | OPEN, not caused by ui-evening`

### F-EV-03, LOW: two new scripts depend on `sharp`, which the repository does not declare

**Location:** `scripts/brand-assets.mjs:35` and `scripts/crop-band-illustrations.mjs:15`, both
`import sharp from "sharp";`, wired into `package.json` as `brand:assets` and `illustrations:band`.

**Trigger.** `package.json` declares seven dependencies and five devDependencies; `sharp` is in
neither. It resolves today only because `next` declares it as an **optional** dependency
(`package-lock.json:1737`, `node_modules/sharp` marked `"optional": true`). `package-lock.json` is
not modified by this batch.

**Consequence.** `npm run brand:assets` and `npm run illustrations:band` fail with
`ERR_MODULE_NOT_FOUND` after `npm ci --omit=optional`, on a platform where Next's optional binary
is skipped, or on a future Next release that drops it. `AGENTS.md` asks that only commands that
exist be documented. Nothing at runtime and nothing in the build depends on this: all four derived
assets and the 13 cropped vignettes are committed, and `brand/README.md` says so.

**Required correction.** Add `"sharp": "^0.35.4"` to `devDependencies` and refresh the lockfile, or
say in `brand/README.md` that the two scripts need `npm i -D sharp` first.

*Register line:* `F-EV-03 | LOW | scripts/brand-assets.mjs:35 and scripts/crop-band-illustrations.mjs:15 import sharp, which package.json declares nowhere; it resolves only as Next's optional dependency, so both documented npm scripts break under npm ci --omit=optional | Declare sharp in devDependencies and refresh the lockfile, or say in brand/README.md that it must be installed first | OPEN`

### F-EV-04, LOW: the hash-anchor guarantee has no working runtime proof

**Location:** `components/shell/scroll-to-top.tsx:25`, and the batch's own
`hashtest.mjs`.

**Trigger.** `hashtest.mjs` prints `direct load /inbox#reconciliation: scrollY 0 … FAIL`. Measured
independently, `/inbox` on the current data is `scrollHeight 900, innerHeight 900, scrollable 0`:
the page is exactly one viewport tall, so `scrollY` can only ever be 0 and the assertion cannot
pass whatever the code does. The badge that would have produced the client-side half of the test is
F-EV-02.

**Consequence.** The claim "hash anchors keep their position" rests on reading the guard
(`if (window.location.hash !== "") return;`, which is correct and is the first statement of the
effect) and not on a measurement. A future change to that effect would not be caught by the script
as it stands, and the FAIL line invites the wrong conclusion in either direction.

**Required correction.** Point the test at a page that is taller than the viewport and carries an
anchor, or assert the anchor's distance from the top of the window against the sticky offset
instead of asserting `scrollY > 0`.

*Register line:* `F-EV-04 | LOW | hashtest.mjs asserts scrollY > 0 on /inbox, which is exactly one viewport tall (scrollHeight 900 = innerHeight 900), so its FAIL proves nothing either way; the hash guard in scroll-to-top.tsx:25 is verified by reading only | Retarget the test at a scrollable page with an anchor, or assert the anchor's offset rather than scrollY | OPEN`

### F-EV-05, LOW: at 1024 px the statement run band is two lines

**Location:** `app/statements/[runId]/page.tsx:170-176`, `app/styles/system.css:666`.

**Trigger.** Open `/statements/c602abcf-…` at 1024 px as ops. The title `Redwood Commercial Brokers`
wraps onto two lines and the band measures **90 px** instead of 69, the only one of the 63 states
that does. Screenshot `rev-focus/1024-statement.png`.

**Consequence.** Cosmetic. It stays well inside the 120 px the band is allowed and there is no
overflow, but the "one line" the batch claims does not hold for a long broker name at 1024. Below
`origin/main`'s own 1024 measurement for the same class of page (96 px), so it is an improvement,
not a regression.

**Required correction.** Optional: bound the title the way `.band-suffix` is bounded (`max-width: 34ch`
plus ellipsis), or drop to 22 px at 1024 as well as at 800.

*Register line:* `F-EV-05 | LOW | /statements/<runId> at 1024 px: the broker firm name wraps and the band is 90 px rather than the one line of 69 px claimed (1 of 63 states measured) | Bound the title as .band-suffix is bounded, or use the 22 px size at 1024 | OPEN`

### F-EV-06, LOW, pre-existing: the policy Endorsements view draws headers over an empty state

**Location:** `app/policies/[policyId]/correction-sections.tsx`, the endorsement schedule table.

**Trigger.** Open `/policies/104d2966-…?view=endorsements` (CGP-01274, no endorsement in force).
The five column headers `Effective / Change / Prorated delta / New annual premium / Ref` are drawn
above an illustration and the sentence "No endorsement is in force on this policy."

**Consequence.** Cosmetic, and an internal inconsistency: `app/inbox/page.tsx:163-166` states the
opposite rule for the same shape ("A section with no rows never draws its column headers … a table
pretending to have content"), and this batch made the inbox follow it. Not in this batch's diff.

*Register line:* `F-EV-06 | LOW | Pre-existing: /policies/<id>?view=endorsements draws its five column headers above the empty state, the shape app/inbox/page.tsx:163 calls "a table pretending to have content" | Hide the headers when the schedule is empty, as the inbox does | OPEN, not caused by ui-evening`

### F-EV-07, LOW: the document GET form has `target` without `rel`

**Location:** `app/policies/[policyId]/correction-sections.tsx:147-152`.

**Trigger.** The two as-of document forms take `target="_blank"`; the five PDF anchors all take
`target="_blank" rel="noopener"`.

**Consequence.** Minimal in practice: the destination is same-origin (`/api/policies/…/documents/…`),
so an opener reference grants nothing an attacker did not already have. It is an inconsistency with
the five anchors beside it rather than an exposure, and the implicit `noopener` that modern browsers
give `<a target="_blank">` is not specified for forms.

**Required correction.** Add `rel="noopener"` to the form for symmetry with the anchors.

*Register line:* `F-EV-07 | LOW | app/policies/[policyId]/correction-sections.tsx:147 the as-of document form takes target="_blank" without rel="noopener", where the five PDF anchors all carry both; same-origin destination, so inconsistency rather than exposure | Add rel="noopener" to the form | OPEN`

---

## 10. Readability (READABLE-CODE.md)

Read for explainability rather than style. The batch reads well and would survive a line-by-line
debrief:

- Every removal of a chip or a name carries a one-line reason and a date beside it
  (`Yoann, 2026-09-09`), so the next reader knows it was a decision and not an accident.
- `components/shell/scroll-to-top.tsx` is 31 lines, one effect, with the hash exception and the
  `<Suspense>` requirement both written out. The reading path is: `PortalFrame` mounts it, it reads
  the URL, it scrolls to 0.
- `components/console-parts.tsx` now holds two explicit lists (`CONSOLE_NAV`, `LEDGER_NAV`) instead
  of one list plus a `sameRoute` predicate that had to be reasoned about. That is a net
  simplification, not just a move.
- `lib/documents/pdf-theme.ts:131-155` explains the compiled-in wordmark by naming the failure it
  avoids, and the contrast note says exactly where `#ff5c00` may and may not be used.
- `scripts/crop-band-illustrations.mjs` keeps its 13-file list by hand and says why parsing two
  TypeScript files to rediscover it would be worse. The white-cut threshold of 30 is justified by a
  measurement at 20, 30 and 40.
- One nit: `app/ops/ledger-views.tsx` re-declares `LEDGER_PATH` and `components/console-parts.tsx`
  declares it again, with a comment explaining that a component must not reach into a route folder.
  The reasoning is sound; the duplication is two string literals that must stay equal. Not opened as
  a finding.

Nothing opaque, no financial formula introduced, no hidden side effect. No money arithmetic is
added anywhere in the batch.

**Candidate walkthrough status: NOT REVIEWED WITH YOANN.** A reviewer cannot certify his
understanding, and this review does not.

---

## 11. Automatic-fail gate for this scope

| Rule | Status for this batch | Evidence |
|---|---|---|
| AF-01 accessible deployed URL | **NOT RUN** | branch review on a local dev server and a local production build; deployment evidence is the coordinator's |
| AF-02 no simulation presented as live | **PASS** | mode line verbatim on nine pages, sandbox sentence verbatim on `/` and `/login`, `TEST DATA, SANDBOX` and `Demo Insurer, work-trial build` on both PDFs |
| AF-03 no UPDATE/DELETE on money rows | **PASS** | no SQL added, nothing under `db/` or `app/api/`, the one `UPDATE` string in the diff is a comment |
| AF-04 sandbox only, no real data | **PASS** | no provider call added; the two brand JPEGs are flat-colour logos, no person, no real data |
| AF-05 no committed secret | **PASS** | `gitleaks` clean on the 12-commit range; `.env.local` untracked |
| AF-06 explainable line by line | **PASS for the reviewer's part**, candidate part **NOT REVIEWED WITH YOANN** | section 10 |

No reviewer can waive a disqualification rule, and a scoped PASS here does not imply the six
delivery gates passed.

---

## 12. Verdict

**PASS at `ui-evening` c120944**, for the scope declared in section 0.

All five claims are supported by the evidence above: the sidebar and the ledger move with the
307 that keeps the query (§4.1, §6), the inbox All view with chips at 0 that open a card (§6), the
one-line 28/24/22 band with no chip row and no person's name across 63 states (§6), the brand in
both PDFs with the wordmark, `#ff5c00` and the issuer intact plus six of six document links opening
in a new tab (§2, §5), and the content hash that the PDF cannot reach (§5.3). 30 of 30 figures
agree, the ledger ties, 534 tests pass, typecheck and build are clean, and 375 px shows no
horizontal overflow.

Four LOW findings are opened, one of which (F-EV-03) is inside the batch's diff and none of which
touches money, authorisation or an automatic-fail rule. Two defects found while probing (F-EV-02,
F-EV-06) are reproduced on `origin/main` and belong to the tree, not to this branch.

**Residual limitations.** Nothing here speaks to the deployed URL, to a second browser engine, to
accessibility beyond the contrast reasoning read in the styles, or to any money path. The 375 px
`BAND NOT STICKY` and `BAND TOO TALL` lines remain the accepted F-UIS-09 and are not re-litigated.
The trial database was being written to by other work while these readings were taken, which is why
the two ledger totals differ between §7.4's two readings while remaining equal to each other.
