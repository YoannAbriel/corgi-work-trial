# Evidence pack (slice B14)

Index of every independent review record, every evidence file and every external sandbox reference
this repository cites. Written on branch `freeze-package`, refreshed from `main` at `c4618e5`
(tonight's live-fire evidence and the live-integration pack) after passes at `49ec797` and `b33edbc`.

**What this is.** The README says "Evidence for the live slots is in `docs/STATUS.md` (event ids,
payment intent and refund ids, amounts) and in the evidence pack." This is that pack. A reviewer
who opens it should be able to go from a claim to the record that made it, to the file that shows
it, to the sandbox object it names, without asking a question.

**What this is not.** It is an index, not a new review. It issues no verdict of its own. Every
verdict quoted below is quoted **verbatim** from the record that issued it, with the line number
where it sits in that file. Where a record was re-reviewed at a later revision, both verdicts are
given, in order, because `REVIEWER.md` requires the history to be preserved rather than overwritten.

**Method.** Records walked: `docs/reviews/*.md` (51), `docs/handoffs/*.md` (29),
`docs/checkpoints/*.md` (2), `docs/STATUS.md` and `docs/COMPLIANCE-MATRIX.md`. Every path they cite
under `docs/evidence/` was resolved against the file system; every file under `docs/evidence/` was
walked back to the record that cites it. Sizes come from `stat`, pixel sizes from `sips`, content
hashes from `md5`. External references were extracted by pattern (`pi_`, `re_`, `cs_`, `acct_`,
`evt_`, `we_`, `cmk_`, `YOA-`) and de-duplicated, with truncated repeats collapsed into the full form.

**Images were opened, not just listed.** Every duplicate-content group found by hashing was opened
and looked at. That is how section 4.3 found six evidence files whose names said one thing and whose
pixels said another; all six have since been recaptured and the corrected files were opened too. A
pack that indexes filenames proves nothing.

**No external service was contacted to build this pack.** No Stripe call, no Vercel call, no
Linear call, no HTTP request to the deployed application. Every figure below is read from the
repository. Where a record states a measurement taken against Stripe or against production, that
measurement is that record's, quoted as its own, and is not re-asserted here as fresh.

**No secret is printed.** `cmk_` values are the public **prefixes** the application itself shows on
`/ops/mcp-keys`; a presented key is the prefix plus 43 further characters (`lib/mcp/key-format.ts`).
No `.env.local`, no `.env.vercel.local` and nothing under `.local/` was opened.

## Counts

**The counting rule.** Every file under `docs/evidence/` counts as an evidence file, whether it is
an image, a PDF, a JSON manifest or a `.txt`. That is deliberate rather than tidy: in
`docs/evidence/live-fire-day2/` the `.txt` files are the **primary** evidence, because they are the
GET readings taken before and after each of Yoann's clicks, and the screenshots illustrate them.
Counting images only would report 297 files and would drop the very readings the live-fire steps
rest on. Where a folder's own reading guide counts differently (the live-integration pack counts
"10 fresh Stripe captures and 4 earlier application captures"), both numbers are given.

| | |
|---|---|
| Records walked | **84** (51 review, 29 handoff, 2 checkpoint, STATUS, COMPLIANCE-MATRIX) |
| Review records carrying a verdict | **50** (`instructions-2026-09-08.md` is an instruction-review record, not a slice review) |
| Evidence files under `docs/evidence/` | **371**, 34.1 MB, in 10 directories |
| Evidence files named individually by a record or its own manifest | **145** |
| of which by an index or manifest the folder carries itself | **139** (`observations.json` 121, `evidence-manifest.json` and `SHA256SUMS.txt` 14, the cycle-2 md5 table 24, overlapping) |
| Evidence files covered by their directory's citation, a stated count or a step record | **226** |
| **Files no record reaches at all (orphans)** | **0** |
| **Files whose content does not match their name** | **0**. Six were found wrong and all six are corrected (section 4.3, F-UI2-08, closed at `c8d679d`) |
| Distinct paths under `docs/` cited by the records | **93** |
| **Dangling citations** | **0** |
| Distinct real sandbox references cited | **93** (23 `pi_`, 3 `re_`, 10 `cs_`, 24 `acct_`, 20 `evt_`, 2 `we_`, 12 `cmk_`) |
| Distinct Linear ids cited | **33** (`YOA-593` to `YOA-656`) |
| Review records ending "NOT REVIEWED WITH YOANN" | **48 of 50** |

---

# 1. Review records, in PLAN slice order

Each section gives the record, the slice, the reviewed revision as the record declares it, the
verdict **verbatim**, the evidence the record cites, and the external references it names.

## Design review (before B1)

### `docs/reviews/architecture.md`

- **Slice:** design review of `docs/ARCHITECTURE.md` (v0 for B1 to B12). Reviewer: independent
  reviewer sub-agent, design review. Timestamp 2026-09-08T08:28:00Z.
- **Reviewed revision:** HEAD `a8d84eba4a7572b2f70e3e4fccb2916137da5edd` (branch `main`), the design
  document uncommitted, SHA-256 `419345fa4e5323517e0daf699c41bf021337fe1e83c94d833203f9e839c2de67`.
  Re-review at HEAD `32a521b1f3731b4cd94a871faa0c6548f968ddf1`, document SHA-256
  `e7acaee177a83f76c23fbb3c9a9535eb2d4779709da217a9266429b821fdc7b1`.
- **Verdict, initial (line 7):** `- Verdict: **DESIGN FAIL** (three HIGH findings, all correctable at document level; see section 8 for which slices are affected).`
- **Verdict, re-review (line 185):** `**DESIGN PASS** for `docs/ARCHITECTURE.md` at SHA-256 `e7acaee1...dc7b1`, permitting implementation of B1 to B12, with one scoped exclusion: the `refund_failed` sentence in section 2 (R-01) is not approved as written and must be corrected before B5 starts; the B5 feature review must confirm it.`
- **Evidence files:** none under `docs/evidence/`; the evidence is the design document and its hash.
- **External references:** none.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B0, B1: bootstrap, deploy, ledger core

### `docs/reviews/b1-ledger-core.md`

- **Slice:** B1 (and B0, whose review the PLAN folds into this record: "DONE (a8d84eb, review with B1)").
- **Reviewed revision:** `2b1539706554e60b1459a3333ed1ba24506642da` (`main`, equal to `origin/main`).
  Re-review at HEAD `8f253a76fe260a72c7791fa6225956fdeccb09a8`, fix commit `a94f091`.
- **Verdict, initial (line 7):** `- Verdict: **FAIL** (one HIGH finding, F-B1-01, correctable with one small migration and one negative test; everything else in the declared scope passes). See section 9.`
- **Verdict, re-review (section 13, "New verdict", line 225):** PASS at `8f253a7`, as recorded in
  `docs/STATUS.md` at 2026-09-08T09:39:11Z ("B1 independent review PASS (re-review at 8f253a7)")
  and in `docs/reviews/recheck-day2.md` line 121 ("fixed, **PASS at `8f253a7`, 2026-09-08T09:40Z**").
- **Evidence files:** none under `docs/evidence/`. The evidence is executable: `check:ledger-guards`
  10/10 on the trial database with every probe rolled back, `check:ledger-seal` 4/4 on `corgi_test`,
  and the arithmetic recomputed by hand in section 6.
- **External references:** `evt_replaytest` (a placeholder naming the two synthetic replay-test
  events disclosed in the README, not a Stripe object).
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B2: issuance and live Stripe collection

### `docs/reviews/b2-issuance-and-collection.md`

- **Reviewed revision:** merge `0115796c585b75fd6f311d49683e9d41b9598372`; then HEAD
  `109dafb033bd4bc14a435277255410bb0e980108`; then `5b14830`; then HEAD
  `b3ba15bac3d4582fef44c9ecc67d4cb33a106124`.
- **Verdict, initial (line 7):** `- Verdict: **FAIL** on one HIGH finding (F-B2-01, an AF-02 exposure in the deployed data, not a code defect), with three MEDIUM findings to correct before the T+24h package. Every code-level control in the declared scope passes its checks. See section 10.`
- **Verdict, second pass (line 209):** `Verdict unchanged: **FAIL** at `5b14830` on F-B2-13, now narrowed to the second door; the first door is closed and verified.`
- **Verdict, final (section at line 249):** PASS at `b3ba15b`, recorded in `docs/STATUS.md`
  ("B2 re-review of the F-B2-13 fixes: PASS at b3ba15b (12:44Z)") and in the PLAN row
  ("DONE (b3ba15b, review PASS, re-review PASS)").
- **Evidence files:** none under `docs/evidence/`; the evidence is the live payment recorded in
  STATUS and the replay checks.
- **External references:** `evt_1UDM4MK6R3v50tIyurIo0iug`, `evt_1UDN8bK6R3v50tIyjLGiVdHN`,
  `evt_1UDNS9K6R3v50tIyBRsuV1Cf`, `evt_3UDM4KK6R3v50tIy0S6PIO4D`, `evt_3UDN8aK6R3v50tIy0yotNigM`,
  `pi_3UDM4KK6R3v50tIy0F5xaBbu`, `pi_3UDN8aK6R3v50tIy0bsGOcBN`, plus the `evt_replaytest` placeholder.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B3: broker KYB live

### `docs/reviews/b3-broker-kyb.md`

- **Reviewed revision:** `09e71e5` (deployed, `/api/health` reports it); slice merged at `b3ba15b`;
  verdict extended unchanged to `faa12a8`.
- **Verdict (section 3, and confirmed by `recheck-day2.md` line 196):** `**PASS at `09e71e5`, 2026-09-08T12:47Z. One verdict only; the record has no re-review section.`
- **Evidence files:** none under `docs/evidence/`; the evidence is the Stripe Connect sandbox and the
  Vercel webhook log, both cited by id.
- **External references:** `acct_1UDNobK6R3ohMVag` (the demo broker's connected account),
  `acct_1UDNv2K6R3y2nGVW` (the failed tax-id fixture), `evt_1UDOJoK6R3ohMVaghFAAnpEU`
  (`account.updated`), `we_1UDKzYK6R3v50tIybe5BIytW` and `we_1UDOHHK6R3v50tIyfbZP2ohD`
  (the account endpoint and the Connect endpoint, each with its own signing secret).
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B4: endorsement with pro-rata delta

### `docs/reviews/b4-endorsements.md`

- **Reviewed revision:** `dfdca38` (the B4 merge), working tree clean at `17f0afa`. Re-review at
  `e7b5913` (fixes `d850f68`, `4a48a26`, `503ee45`, `dcad358`, merged at `26dede3`).
- **Verdict, initial (line 208):** `**FAIL.**`
- **Verdict, re-review (line 227):** `### Verdict for the B4 scope after the fixes: **PASS**`
- **Evidence files:** the two PDFs and their rendered pages under `docs/evidence/pdf/`
  (declarations page and endorsement schedule as of 2028-10-01).
- **External references:** none of its own.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B5: cancellation with a real refund

### `docs/reviews/b5-cancellation-and-refund.md`

- **Reviewed revision:** merge `e120f695202c4d1cf7cee14ad436f5a36f15afcc`.
- **Verdict (line 7):** `- Verdict: **PASS** for the declared scope at `e120f69`, with four MEDIUM findings to correct before submission (none blocks the slice; see section 10) and eight LOW items.`
- **Evidence files:** none under `docs/evidence/`; the refund objects themselves are the evidence.
- **External references:** `pi_3UDM4KK6R3v50tIy0F5xaBbu`, `re_3UDM4KK6R3v50tIy0scSGaps`
  (created by the delegate's worktree server, which is why F-B5-04 stayed open until Yoann drove a
  refund from the deployed application), `evt_3UDM4KK6R3v50tIy0BATMXH1`,
  `evt_3UDM4KK6R3v50tIy0I9DG4JB`, `evt_3UDM4KK6R3v50tIy0QPYBl3S`, `evt_3UDM4KK6R3v50tIy0WXEvJDH`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B7: claims, reserves, payout, maker-checker

### `docs/reviews/b7-claims-and-approvals.md`

- **Reviewed revision:** code read at `85da484`, verdict carried unchanged to `ab49f0d`. Re-review at
  `65b06be`, read at `d7d173d`, deployed and verified at `6e8805e`.
- **Verdict, initial (line 9):** `- Verdicts: **B7: FAIL** on one HIGH finding (F-B7-01, an approver's rejection of an above-threshold refund can be overridden by the maker). **Rule 14: PASS**, with two LOW findings.`
- **Verdict, re-review (line 268):** `- **Verdict for the B7 scope after the fixes: PASS.** The HIGH finding is closed, both MEDIUMs are closed, and the two LOWs in this batch are closed.`
- **Verdict, final (line 353):** `**Verdict, B7 scope at `65b06be`: PASS.** F-B7-01, F-B7-02, F-B7-03, F-B7-04 and F-B7-11 are closed; F-B7-05 to F-B7-10 and F-B7-12 remain open as recorded, all LOW; F-B7-13 is new and LOW. **Rule 14 stays PASS**, now with F-B7-11 closed. Walkthrough status: **NOT REVIEWED WITH YOANN**.`
- **Evidence files:** none under `docs/evidence/`; the maker-checker refusals were proven over HTTP
  on production against the initiator, a broker, a customer and an anonymous caller.
- **External references:** none of its own.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B8: backdated correction and as-of

### `docs/reviews/b8-corrections.md`

- **Reviewed revision:** `e7b5913` (production reported it at 17:54Z). Re-review at `2755d11`.
- **Verdict, initial (line 8):** `- **Verdict**: **FAIL**, on one HIGH and two MEDIUM findings. The correction transaction itself is sound; the failures are downstream of it.`
- **Verdict, re-review (line 263):** `- **Verdict**: **PASS** for slice B8 at `2755d11`, with two new LOW findings (F-B8-08, F-B8-09) and F-B8-06 left open by the coordinator's decision. The three findings that carried the FAIL are resolved and each is proven by a check line or a deployed response rather than by a claim.`
- **Evidence files:** none under `docs/evidence/`; the evidence is `check:correction-replay` and the
  reviewer's from-scratch reproduction of the worked example.
- **External references:** none of its own.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B9: broker monthly statement

### `docs/reviews/b9-statements.md`

- **Reviewed revision:** `44188bd` (the B9 merge); re-check at `afeba97`; scoped re-review at
  `8b5b490` (deployed revision reported `8e6d468`, a descendant, and the record says so).
- **Verdict, initial (line 12):** `**Verdict: FAIL.** One HIGH finding (F-B9-01). Net due is correct and ties to the ledger in every`
- **Verdict, second (line 530):** `**New verdict: FAIL**, on the new finding F-B9-09. F-B9-01 is resolved. The slice is otherwise`
- **Verdict, final (line 686):** `**Verdict for this scope: PASS.** F-B9-09 is resolved and verified on production. Four other`
- **Evidence files:** the statement PDF and its rendered page under `docs/evidence/pdf/`
  (`statement-2028-03-revision-2.pdf` and `-1.png`), plus the empty and long-provisional edge cases.
- **External references:** none of its own.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/backend-monthly-statements-r1.md` (decision 30, automatic monthly close)

- **Reviewed revision:** `ffa1b691fe1e21cc1d37c70b3a0f48874d090b7f` (branch
  `worktree-wf_46bb3e09-77f-3`, four commits `33018aa`, `3f05a02`, `f6a6005`, `ffa1b69`).
- **Verdict (line 282):** `**PASS** at `ffa1b691fe1e21cc1d37c70b3a0f48874d090b7f`. Every requirement of the slice is`
- **Evidence files:** none under `docs/evidence/`; `check:statements` on the disposable database.
- **External references:** none.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B10: reconciliation

### `docs/reviews/b10-reconciliation.md`

- **Reviewed revision:** the B10 merge `28a361c` (branch commits `e4aa7f4` to `a505ec7`); re-review
  covering `010a6fe`, contained in `e7b5913`.
- **Verdict, initial (line 6):** `Verdict: **FAIL** on F-B10-01. Everything else in the declared scope is supported.`
- **Verdict, re-review (line 465):** `## Verdict: PASS`
- **Evidence files:** none under `docs/evidence/`; the evidence is the planted PaymentIntents found
  on the real sandbox and named by id.
- **External references:** `pi_3UDKjJK6R3v50tIy0nLbDPOc`, `pi_3UDKq0K6R3v50tIy1mwQmeWT`,
  `pi_3UDL2qK6R3v50tIy0hthuI6E`, `pi_3UDQkNK6R3v50tIy0LYkcx0u`, `pi_3UDQliK6R3v50tIy12QwbLZu`,
  `pi_3UDQN7K6R3v50tIy0fdlIi1Q`, `pi_3UDQPZK6R3v50tIy0hKAIFiq`, `pi_3UDRg7K6R3v50tIy0gT73SMV`,
  `pi_3UDRpWK6R3v50tIy1583aoau`, `re_3UDKq0K6R3v50tIy11aPmuHK`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/backend-breaks-board-r1.md` (decision 28, round 1)

- **Reviewed revision:** `dee775b00cb933b47a52b600931c128ddc1aae78` (branch
  `worktree-wf_46bb3e09-77f-1`, five commits `f33db1a`, `9309804`, `ef72990`, `231a7a6`, `dee775b`).
- **Verdict (line 15):** `- **Verdict: FAIL** (one MEDIUM finding, plus one check assertion that failed on the shared database).`
- **External references:** `pi_3UDlr7K6R3v50tIy0QljajXB` (the probe this round planted).
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/backend-breaks-board-r2.md` (round 2, supersedes r1)

- **Reviewed revision:** `4cf3cc9d5144fdeef633f97a5197f1c3f8dca593` on
  `worktree-wf_46bb3e09-77f-1-fix`, read as `git diff main...4cf3cc9`.
- **Verdict (line 8):** `- **Verdict: FAIL**, on one MEDIUM finding (F-BREAKSBOARD-07). Round 1's MEDIUM, F-BREAKSBOARD-01, is resolved and verified; four LOW findings of round 1 are still open.`
- **External references:** `pi_3UDmmGK6R3v50tIy1644vwL5`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/backend-breaks-board-r3.md` (round 3, the standing verdict)

- **Reviewed revision:** `48d6e63d81c617dbc9bf607468eb47a3feb04373` on `slice/breaks-board-fix-r3`,
  read as `git diff origin/main...48d6e63` (20 files, +1369 / -101) and `git diff 268d23f 48d6e63`
  (9 files, +135 / -60).
- **Verdict (line 8):** `- **Verdict: PASS.** Both MEDIUM findings (F-BREAKSBOARD-01 and 07) are resolved and I reproduced both fixes live. The seven LOW findings are resolved; F-BREAKSBOARD-06 and 10 stay as accepted INFO. Five new findings, one LOW and four INFO, none blocking.`
- **External references:** `pi_3UDnkbK6R3v50tIy06l6snib`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B11: the MCP surface

### `docs/reviews/b11-mcp.md`

- **Reviewed revision:** `main` at `5f2c841`; the slice landed with the merge `e7d7856`.
- **Verdict (line 470):** `**B11 scope at `5f2c841`: PASS**, with one MEDIUM to close before submission.`
- **Evidence files:** the MCP session transcript `docs/handoffs/b11-mcp-session.md`.
- **External references:** MCP key prefixes `cmk_3406a68e`, `cmk_3d521874`, `cmk_7e21871d`,
  `cmk_824766ae`, `cmk_b03b5d79`, `cmk_c83341c2` (public prefixes, never a key).
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/backend-mcp-tools-r1.md` (decision 29, round 1)

- **Reviewed revision:** `6a41c2a96ba35b3bc840c63fab71647275ca89e1` (branch
  `worktree-wf_46bb3e09-77f-2`, five commits).
- **Verdict:** FAIL on F-MCPTOOLS-01 (line 88 of its matrix: `**FAIL, F-MCPTOOLS-01**`), recorded in
  the register as "MCP tools round 1, FAIL at `6a41c2a`".
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/backend-mcp-tools-r2.md` (round 2, supersedes r1)

- **Reviewed revision:** `5976e4f6f90c08aca55e7e76db0fd2a37ec244ee`.
- **Verdict (line 305):** `**FAIL** at `5976e4f6f90c08aca55e7e76db0fd2a37ec244ee`.`
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/backend-mcp-tools-r3.md` (round 3, the standing verdict)

- **Reviewed revision:** `ce42a3c331f8dc2006ead1f2ee6887c181047e9d`.
- **Verdict (line 333):** `**PASS** at `ce42a3c331f8dc2006ead1f2ee6887c181047e9d`, for the scope of this slice.`
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/backend-inspect-reference-r1.md` (decision 42, round 1)

- **Reviewed revision:** `0b9202d897f9d620dbf302c22accdf07e85d5d81`. Written 2026-09-09T19:55Z.
- **Verdict (line 273):** `**FAIL** at `0b9202d897f9d620dbf302c22accdf07e85d5d81`, on F-INSPECT-01 (MEDIUM), following this`
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/backend-inspect-reference-r2.md` (round 2, the standing verdict)

- **Reviewed revision:** `9b9902a992a4958c0dd54ec08fd0d93fb51b1628`. Written 2026-09-09T18:22Z.
- **Verdict (line 207):** `**PASS** at `9b9902a992a4958c0dd54ec08fd0d93fb51b1628`.`
- **External references:** `cmk_deadbeef` (a placeholder used to prove a wrong key is refused).
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B12: impact preview and explanation

### `docs/reviews/b12-explain.md`

- **Reviewed revision:** `b40e803` (`main`); re-review at `19baf15`.
- **Verdict, initial (line 331):** `**PASS** for the scope declared above, at `b40e803`, deployed and measured.`
- **Verdict, re-review (line 532):** `**PASS** at `19baf15`, deployed and measured.`
- **External references:** Linear `YOA-625`, `YOA-626`, `YOA-634`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/inbox-and-motion.md` (B13-8 inbox and B12-4 animated explanation)

- **Reviewed revision:** `db1762a` (`main`); joint re-review at `41ea2c5`.
- **Verdict, initial (line 510):** `**Inbox (YOA-636, merges `d437280` and `08f2493`): PASS**, with one MEDIUM and five LOW findings.`
- **Verdict, re-review (line 764):** `**Inbox (B13-8, YOA-636): PASS** at `41ea2c5`. All six findings fixed and measured, none reopened, one new LOW (F-B13-60) about a guard weaker than its own comment.`
- **Evidence files:** the 18 frames under `docs/evidence/b12-4/`, named in the record and in
  `docs/handoffs/b12-4-notes.md`. The record discloses that no reviewer ran the animation in a
  browser (no Playwright in the tree) and that the frames remain the builder's.
- **External references:** Linear `YOA-636`, `YOA-637`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## B13: hardening, screens, integration

### `docs/reviews/b13-2-low-batch.md`

- **Reviewed revision:** `main` at `78f93c6`; the batch itself is the merge `82591a0`.
- **Verdict (line 279):** `**PASS** for batch B13-2 at `82591a0`, reviewed on `main` at `78f93c6` and measured on the`
- **External references:** `cmk_b39b7f79`; Linear `YOA-628`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/b13-6-change-requests.md`

- **Reviewed revision:** `main` at `b40e803`; re-review at `06999e3`, measured on `19baf15`.
- **Verdict, initial (line 288):** `**PASS** for slice B13-6 at revision `b40e803`, scope: migration 0019, `lib/policy/change-requests.ts`,`
- **Verdict, re-review (line 450):** `**PASS** for slice B13-6 at `06999e3`, measured on the deployed descendant `19baf15`. Five of the`
- **External references:** Linear `YOA-634`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/b13-9-console.md` (three sections: review, re-review, confirmation)

- **Reviewed revision:** `main` at `5d405d2` (slice merge `020fd86` plus navigation commit
  `5d405d2`); re-review at `d786644`; confirmation at `e117a61`.
- **Verdict, initial (line 470):** `**FAIL**, on one blocking finding.`
- **Verdict, re-review:** PASS at `d786644` (STATUS 2026-09-09T08:48:00Z, "Verdict PASS. Record
  appended to docs/reviews/b13-9-console.md").
- **Verdict, confirmation (line 888):** `**PASS.** F-INT-03 is fixed at the deployed revision, in the three readers the correction named, by`
- **External references:** Linear `YOA-638`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/b13-11-observability.md` (decision 25)

- **Reviewed revision:** `f7e81aa5e248c9e3ab35c19ccda8454344147413`; re-review at
  `06166cb7e068df1b2f7ca756e3c22a3f82d155b1`.
- **Verdict, initial (section 10, line 440):** `**PASS.**`
- **Verdict, re-review (section 12.6, line 759):** `**PASS.**`
- **External references:** Linear `YOA-641`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/b13-screens.md` (three key screens, five states)

- **Reviewed revision:** `08b3678`; confirmation at `3e9d095`.
- **Verdict, initial (line 13):** `**Verdict: FAIL**, on one MEDIUM finding (F-B13-30): a single click on "Explain this amount"`
- **Verdict, confirmation (line 620):** `unchanged. **The slice verdict moves from FAIL to PASS**, with those four LOW items outstanding.`
- **Evidence files:** the 38 frames under `docs/evidence/b13-screens/`, three screens by five states
  by two widths, plus the four fold frames that carry F-B13-30 before and after. The record keeps
  **both** the overflowing and the fixed frames, which is why the pair exists.
- **External references:** `re_3UDKq0K6R3v50tIy11aPmuHK`; Linear `YOA-602`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/b13-13-ui-audit.md` (the desktop audit fix cycles A, B, C)

- **Reviewed revision:** `06166cb7e068df1b2f7ca756e3c22a3f82d155b1`, `/api/health` reporting it at
  11:30:16Z and again at 12:02Z.
- **Verdict (line 17):** `**Verdict: FAIL for the cycle**, on one MEDIUM finding that is squarely inside the audit's own`
  numbering: **F-UA-01**, UI-004 is fixed on `/ops/policies` and left untouched on `/broker`.
- **Evidence files:** "one PNG per issue under `docs/evidence/b13-13-ui-audit/`, named by issue id"
  (line 174), 30 files. Its source of truth is `docs/ui-audit-2026-09-09.json` (35 issues) whose
  122 captures are indexed by `docs/evidence/ui-audit-2026-09-09/observations.json`.
- **External references:** `pi_3UDf5YK6R3v50tIy1GkJdCCi`, `re_3UDN8aK6R3v50tIy0J6CmRy3`;
  Linear `YOA-643`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/b13-14-low-screens.md` (the LOW screens sweep confirmation)

- **Reviewed revision:** `389030078659e1b1f054cee78c7d5822b5018b1d` (`3890300`), `/api/health`
  reporting it at 12:28:26Z and again after every measurement.
- **Verdict (line 17):** `**Verdict: FAIL for the cycle**, on one item and one item only: **F-INT-20 is closed on the operations table of the console 360 and left open on the timeline table of the same screen** (finding **F-LU-01**).` The other sixteen items are PASS, each with a measurement.
- **Evidence files:** the 12 PNGs under `docs/evidence/b13-14-low-screens/`; the record's AF-05 line
  states that all twelve were opened and reviewed, and that `ua05-ops-approvals.png` shows an MCP
  key **prefix**, which is what the screen prints for every operator, plus two sha256 digests and a
  Stripe test id.
- **External references:** Linear `YOA-644`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/b13-14-low-sweep.md` (the LOW library sweep)

- **Reviewed revision:** `bf36b27` (`Merge branch 'low-backlog-sweep'`, pushed 12:23Z); the code
  commit is `2b904a7`, the diff read is `git diff bf36b27^1 bf36b27`, 11 files.
- **Verdict (line 339):** `**PASS** for the nine findings at **bf36b27**, with four LOW findings opened (F-LS-01 to F-LS-04),`
- **External references:** Linear `YOA-644`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/backend-corrections-rule-24-r1.md` (decision 31)

- **Reviewed revision:** `slice/corrections-rule-24` at
  `0510c1b51e66f9245789c8523005f877e49ea012` (two commits `f0aa2d9`, `0510c1b`), 353 insertions,
  154 deletions. Written 2026-09-09T13:50Z.
- **Verdict:** PASS, recorded in the register as "Corrections on decision 24 (decision 31), PASS at
  `0510c1b`", with six findings (five LOW, one INFO) all open on the B13 backlog.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/backend-guards-and-key-trigger-r1.md` (decision 32)

- **Reviewed revision:** `845443abf3d2146c4471ee6f161bc81e9d40333d`.
- **Verdict (line 312):** `**PASS** at `845443abf3d2146c4471ee6f161bc81e9d40333d`.`
- **Note carried by this record:** migration 0023 for the rate tables was **not written**, because
  the builder and the reviewer verified independently that `brokers` and `state_tax_rates` already
  carried the append-only guards. Two assertions were added to the guards proof instead, and
  F-INT-09 is wrong on that point. Decision 32's correction note in `docs/DECISIONS.md` records it.
- **External references:** `cmk_xxxxxxxx` (a redaction pattern, not a key).
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## The interface records (B13 presentation)

### `docs/reviews/ui-01.md`

- **Reviewed revision:** branch `codex/corgi-interface`, base
  `59f2fcdf969ad92ad43b299dbac886593cb918bc` plus the working diff.
- **Verdict (line 67):** `Final verdict: **PASS for UI-01's frozen presentation scope.** No unresolved material finding remains in this scope. ... AF-01 deployment and AF-06 candidate confirmation remain separate final-delivery gates, not implied passes. B13 and the integrated trial are incomplete; this review does not approve existing financial gaps, a merge, deployment or submission. Candidate walkthrough remains **NOT REVIEWED WITH YOANN**.`
- **Evidence files:** `docs/handoffs/ui-01.md`, `ui-01-artwork.json`, `ui-01-source-manifest.json`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/ui-02.md`

- **Reviewed revision:** branch `codex/corgi-interface`, base
  `c7784048a646c30c398d744eb451cd0e62ec128e`.
- **Verdict (line 55):** `Final verdict: **PASS for UI-02's frozen presentation scope**, with UI02-L01 disclosed. This is not a final trial, B13, deployment, merge or submission approval. Authenticated financial screens were source/build reviewed and were not each exercised with sandbox data. ... Candidate understanding remains **NOT REVIEWED WITH YOANN**.`
- **Evidence files:** `docs/handoffs/ui-02.md`, `ui-02-artwork.json`, `ui-02-fonts.json`,
  `ui-02-source-manifest.json`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/ui-03.md`

- **Reviewed revision:** branch `codex/corgi-interface`, base/HEAD
  `9acbb5bd8881ccdb72b5b89df619acbbf6fb2401`; seven-file source delta identified by
  `docs/handoffs/ui-03-source-manifest.json`, SHA-256
  `d154b040bd0a4983d4d8a9ff33384a277a13b7074cf06a15195a445977201a7f`, all seven content hashes
  independently matched.
- **Verdict (line 41):** `**PASS for the exact seven-file UI-03 implementation and bounded local navigation evidence. No unresolved material finding identified in this scope.**`
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/ui-04.md`

- **Reviewed revision:** dedicated worktree `.worktrees/corgi-interface`, branch
  `codex/corgi-interface`, initial clean HEAD `20f3084`.
- **Verdict (lines 13 and 15):** two scoped design passes: `**DESIGN PASS** for the proposed read-only `/ops/policies` page` and `**DESIGN PASS** for preserving native form DOM in the local demo while allowing input and GET-only preview navigation.`
- **Evidence files:** `docs/handoffs/ui-04.md`, `ui-04-local-harness.json`,
  `ui-04-source-manifest.json`; the record inspected a refreshed `home-desktop.png` and matched all
  three independently computed hashes.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/ui-back-controls.md`

- **Reviewed revision:** `cd6d5676a050638c961ad9043dd996486329e715` against parent
  `957c88573598a93588fa21aeafc645a5cf347d71`; final at `586d5b9`.
- **Verdict, initial (line 42):** `**Verdict: FAIL for cd6d567**, limited to F-BACK-01. The redundant-back-control removal passes independently, but the combined cosmetic increment needs the narrower wrapping rule and an affected re-review before completion. No legal certification or integrated trial PASS.`
- **Verdict, final (line 56):** `**Final verdict: PASS for this bounded cosmetic increment at 586d5b9.** No unresolved material finding in this diff. The earlier FAIL remains historical.`
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/ui-main-merge.md`

- **Reviewed revision:** merge `856e75c0d63c2c5e4324a27a3b8935d734cfc11e`, parents `bfa2dca` (main)
  and `66fb7fe` (`codex/corgi-interface`), merge base `e110a7c`.
- **Verdict (line 18):** `Verdict: **PASS** for the interface scope, with F-UI-01 recorded as found in the reviewed revision`
- **Evidence files:** `docs/handoffs/ui-main-browser-checks.json`,
  `ui-main-source-manifest.json`, `docs/handoffs/ui-main-merge.md`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/ui-polish.md`

- **Reviewed revision:** merge `c5bcf2aeb6091713250fac73ceb04060fef834be`, parents `2755d11` (main)
  and `d886a4f`; extended to `41be7fc`.
- **Verdict, initial (line 16):** `Verdict: **PASS** for the interface-polish scope, with F-UI-12 (MEDIUM) as a required correction`
- **Verdict, extension (line 626):** `**PASS maintained.** `41be7fc` is six lines of presentation on top of the reviewed merge: no business logic, no form contract, no guard, no money path.`
- **Evidence files:** `docs/handoffs/ui-polish-notes.md`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/ui-rebuild.md`

- **Reviewed revision:** `e341f8333dac26a90c41b34573ffaec279688377`; re-review at
  `fea572ce5e711a707e2b306307a162cbd0715b5f`.
- **Verdict, initial (line 11):** `**Verdict: FAIL**, on one MEDIUM finding (F-UI-22). Everything else in the declared scope passes.`
- **Verdict, re-review (line 716):** `**PASS** for `fea572c`, scoped to the screen rebuild reviewed above plus this fix.`
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/ui-system.md` (the end-to-end interface rework, branch `ui-system`)

- **Reviewed revision:** `2af6ebe3156c66bae35f831cc1323aaedd6d854e`; merged into `main` at `489a36d`.
- **Verdict (line 369):** `**PASS at `2af6ebe3156c66bae35f831cc1323aaedd6d854e`.**`
- **Evidence files:** `docs/handoffs/ui-system-brief.md` and `ui-system-notes.md`.
- **External references:** `pi_3UDf5YK6R3v50tIy1GkJdCCi`, `re_3UDN8aK6R3v50tIy0J6CmRy3`;
  Linear `YOA-656`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## The illustration records (B13 assets)

### `docs/reviews/illustration-library.md` (Codex sub-agent)

- **Reviewed revision:** `824ed34979c07a90d5c7c8f5e1779835288f54cd` against parent
  `333f73ff44f6e70c0f8ad2618ab6021da3eadb1c`; a second section at
  `e4ee798b89abee15a3fa26d54694781930ae7658`, parent `ee61e0f3aeed7e8def21026dd3659701522e272a`.
- **Verdict (line 117):** `AF-01: **NOT RUN** (deployment). AF-02: **PASS scoped claims**, with financial live-sandbox verification **NOT RUN**; this change accurately describes interpolation and no financial integration. AF-03: **PASS scope isolation**`
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/illustration-integration.md` (Codex sub-agent)

- **Reviewed revision:** initial `19e0c43c2c29ece5edbc0da4b68e124674a1139e`, final
  `13b244bae916972f0c35dcded7087df7a99abcf6`, branch `codex/corgi-interface`; the merge check at
  `6370f36bfb05b8ddae05811722e28ab377449df3`.
- **Verdict (line 98):** `**Verdict: PASS for YOA-639 illustration integration at `6370f36bfb05b8ddae05811722e28ab377449df3`.** No new material finding; F-ILL-01/02 remain resolved and inherited LOW F-ILL-03 remains advisory. AF-01 deployment and AF-06 human understanding remain NOT RUN.`
- **External references:** Linear `YOA-639`.
- **Walkthrough:** the record states human understanding is NOT RUN.

### `docs/reviews/illustration-cross-review.md` (Claude cross-model review of the Codex work)

- **Reviewed revision:** `08b3678d820e8b7d99caebe11f9e610497a05260`, verified live; confirmation at
  `5fa3d49f7e7ab5f469cb2a86141f08ca9224b817`.
- **Verdict, initial (line 192):** `**FAIL for the illustration integration at `08b3678d820e8b7d99caebe11f9e610497a05260`, limited to F-IL-01 and F-IL-02.**`
- **Verdict, confirmation (line 271):** `**PASS. F-IL-01, F-IL-02, F-IL-05 and F-IL-06 are closed at `5fa3d49f7e7ab5f469cb2a86141f08ca9224b817`.** The FAIL recorded above was limited to F-IL-01 and F-IL-02, so **it is lifted**: the illustration integration now passes at this revision.`
- **External references:** Linear `YOA-639`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

## Cross-cutting records

### `docs/reviews/recheck-day2.md` (audit of which verdicts still cover deployed code)

- **Reference revision:** `5d405d2` on `main`, production reporting the same revision.
- **Nature:** the record says of itself that it is `an audit record, not a review record under
  REVIEWER.md. It issues no new verdict`. It classifies fifteen status lines (B0 and B1 DONE AND
  REVIEWED; B2 to B11 DONE with material code after their last PASS; B12 and B13 partial; B14 not
  started) and registers F-RC-01 to F-RC-12.
- **External references:** `cmk_e96f88a4`, `pi_3UDQN7K6R3v50tIy0fdlIi1Q`,
  `re_3UDN8aK6R3v50tIy0J6CmRy3`.
- **Walkthrough:** NOT REVIEWED WITH YOANN. Its AF-06 table is the source of the sentence
  "every record ends NOT REVIEWED WITH YOANN".

### `docs/reviews/post-pass-changes.md` (every money-path change made after its slice's PASS)

- **Reviewed revision:** `main` at `cc7bdda`; overall verdict revised at `ea204d7`.
- **Verdicts, per section:** A rule 21 `### A.4 Verdict for A: **PASS**` (line 151); B posting locks
  `### B.6 Verdict for B: **PASS**` (line 261); C statement format v3 **FAIL** on F-PP-05 (line 333);
  D, E, F, G PASS.
- **Verdict, overall (line 739):** `**Overall verdict, revised: PASS**, for the seven changes A to G at revision `ea204d7`.`
- **External references:** `cmk_e96f88a4`, `cmk_f035edcc`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/integration.md` (the final integration review REVIEWER.md requires)

- **Reviewed revision:** `08b3678d820e8b7d99caebe11f9e610497a05260`; re-review at
  `a1e525ddd02e412cc1dd1e0d338d4d62d747d64c`; decision 24 section at `20439ad`.
- **Verdict, initial (section 9, line 798):** `**FAIL for the integration at `08b3678`.**` The record
  immediately qualifies the word: `**No money is wrong.** Every one of the 24 money figures I
  compared across the journal, the policy pages, the explanation folds, the approvals screen, the
  statement and the reconciliation board agrees to the cent`. The FAIL is F-INT-01 (HIGH): a
  `staff_approver` could mint the operator's MCP key, raise a money-out with it and approve it.
- **Verdict, re-review (section 11.12, line 1196):** `**PASS for the five findings re-reviewed here, and the integration verdict of section 9 is lifted from FAIL to PASS at `a1e525d`, with the residual limitations below and with AF-06 still NOT SATISFIED.**`
- **Verdict, decision 24 (section 12.8, line 1462):** `**PASS. F-INT-12 is FIXED at `20439ad` and closed.**`
- **Verdict, standing (line 1472):** `The integration verdict of section 11.12 is unchanged: **PASS at the reviewed revision**, with AF-06 still NOT SATISFIED, F-INT-04 and F-INT-06 still assigned to Yoann as one click each, and the LOW findings F-INT-08, 09, 11, 20, 21, 22 and now 23 open and disclosed.`
- **External references:** `cmk_e96f88a4`, `pi_3UDf5YK6R3v50tIy1GkJdCCi`,
  `re_3UDN8aK6R3v50tIy0J6CmRy3`.
- **Walkthrough:** NOT REVIEWED WITH YOANN, and AF-06 explicitly NOT SATISFIED.

### `docs/reviews/backend-production-confirmation.md` (the backend track on the deployed application)

- **Reviewed revision:** `100ef4124e1c3d8fcb9625211019f9bb35063a69`, confirmed on the deployed
  application; the record states `100ef41` was committed at 2026-09-09T16:30:42Z and that the
  revision did not move while the review ran.
- **Verdict:** FAIL on one expected item. The register records it as "Production confirmation of the
  backend track ... FAIL at `100ef41` on one expected item ...; MCP tools, monthly job, corrections,
  key creator, the 24 figures and the AF gate all PASS". The failing item is **F-BP-01**, whose
  register line reads: `EXPECTED, closes with one reconciliation run on production: probe is a
  classification a run stores, and the latest complete Stripe run (16:25Z) predates the deploy`.
- **AF table, quoted:** `| AF-01 accessible deployed URL | **PASS in scope** |`,
  `| AF-02 nothing simulated presented as live | **PASS in scope, with F-BP-03** |`,
  `| AF-03 never UPDATE or DELETE a money row | **PASS** |` (the one write of the review was an
  INSERT; an `update reconciliation_break_notes` as `app_runtime` inside a rolled-back transaction
  answered `permission denied for table`).
- **The one write this review made:** one $42.42 probe break explained by ops, the note row read
  back with the database clock, the break leaving the badge, the inbox, the board and the MCP tool
  (36 to 35).
- **External references:** `pi_3UDf5YK6R3v50tIy1GkJdCCi`, `pi_3UDQN7K6R3v50tIy0fdlIi1Q`,
  `re_3UDN8aK6R3v50tIy0J6CmRy3`.
- **Walkthrough:** NOT REVIEWED WITH YOANN.

### `docs/reviews/instructions-2026-09-08.md`

- **Nature:** a record of the three independent reviews of the instruction files themselves
  (brief coverage, financial and security rules, workflow and readability), completed before any
  product code existed. Its companion is `instruction-files-2026-09-08.json`. It carries scoped
  design PASS verdicts on the instructions, and `docs/STATUS.md` states of that period:
  "Product AF-01 through AF-06 verification: NOT RUN."

### `docs/reviews/ui-cycle-2.md` (interface cycle 2, and the breaks-board port)

- **Slice:** B13 presentation, the cycle that ports the breaks board onto the reworked page. It is
  the record `docs/reviews/FINDINGS.md` rows F-BP-02 and F-BP-03 named as their pending confirmation.
- **Reviewer:** independent interface reviewer sub-agent, own worktree
  `.claude/worktrees/agent-a6976ba1aaae6e2e7`. Written 2026-09-09 between 18:00Z and 19:10Z.
- **Reviewed revision:** `c408cb30ca79ae9b6a9efc9a2e553d3956f2fdb4` (`c408cb3`, `main`, the merge of
  `ui-fixes`; parents `2387190` and `0d2b50d`). Production reported that revision at `/api/health`
  at 18:05:44Z before the first measurement and at 18:28:11Z after the last.
- **Verdict (line 525):** `**PASS at `c408cb30ca79ae9b6a9efc9a2e553d3956f2fdb4`.**`
- **What it closes:** F-BP-02 and F-BP-03. The record states F-BP-02 `CLOSED at `c408cb3`: the
  explained break is visible under `Explained breaks` with its note, `Sam Patel, operations` and
  `2026-09-09 16:39:11`; the count to act on is 35 against the run's 36`.
- **Evidence files:** 24 PNGs under `docs/evidence/ui-cycle-2/`, listed in its section 11 with an
  md5 each. **Six of them did not show what they were named for; all six were recaptured** at
  `c8d679d` and the record's section 12 records the defect, its cause and its fix rather than
  rewriting the original sentences. See section 4.3. The F-BP-02 evidence itself
  (`recon-explained.png`) was always genuine and was opened for this pack.
- **Open findings:** F-UI2-01 to F-UI2-07, all LOW, none blocking; F-UI2-04 closed as not reproduced
  (`docs/STATUS.md` at the commit merging `92379e2`).
- **Walkthrough:** NOT REVIEWED WITH YOANN.

---

# 2. Evidence files

371 files, 34.1 MB, in ten directories. Every one is reachable from a record. Sizes are from
`stat`, pixel sizes from `sips`.

| Directory | Files | Bytes | The record that cites it |
|---|---|---|---|
| `docs/evidence/live-fire-day2/` | 90 | 5.0 MB | `docs/handoffs/live-fire-day2.md`, which names every step folder and its files. Five steps: LIVE-0, LIVE-8, LIVE-9, LIVE-7, LIVE-3 |
| `docs/evidence/live-integration-2026-09-09/` | 18 | 1.9 MB | Carries its own reading guide (`00-START-HERE.md`), manifest, `SHA256SUMS.txt` and an independent Codex review (`REVIEW-NOTES.md`) |
| `docs/evidence/ui-audit-2026-09-09/` | 124 | 10.3 MB | `docs/ui-audit-2026-09-09.json` (the audit report) and `docs/STATUS.md` at 09:57:00Z; replayed by `docs/reviews/b13-13-ui-audit.md` |
| `docs/evidence/ui-cycle-2/` | 24 | 4.0 MB | `docs/reviews/ui-cycle-2.md` section 11, which names all 24 with their md5. Six were recaptured to close F-UI2-08, section 4.3 |
| `docs/evidence/b13-screens/` | 38 | 3.0 MB | `docs/reviews/b13-screens.md`, `docs/COMPLIANCE-MATRIX.md`, `docs/reviews/FINDINGS.md` |
| `docs/evidence/b13-13-ui-audit/` | 30 | 3.8 MB | `docs/reviews/b13-13-ui-audit.md` line 174, "one PNG per issue ... named by issue id" |
| `docs/evidence/b12-4/` | 18 | 1.5 MB | `docs/handoffs/b12-4-notes.md`, `docs/reviews/inbox-and-motion.md`, `docs/COMPLIANCE-MATRIX.md`, `README.md` |
| `docs/evidence/pdf/` | 13 | 1.7 MB | `docs/STATUS.md` at 06:53:30Z, `docs/COMPLIANCE-MATRIX.md` row DOC-01, `docs/handoffs/b12-pdf-notes.md` |
| `docs/evidence/b13-14-low-screens/` | 12 | 1.1 MB | `docs/reviews/b13-14-low-screens.md`, which names five by filename and states that all twelve were opened |
| `docs/evidence/b12-1/` | 4 | 1.9 MB | `docs/handoffs/b12-1-agent-demo.md` section 9, `README.md`, `docs/COMPLIANCE-MATRIX.md` row BLD-09, `docs/reviews/recheck-day2.md` |

Two files are worth naming on their own:

- `docs/evidence/ui-audit-2026-09-09/observations.json` (271 lines of JSON, 122 entries) is the
  **index**: for each capture, its id, the URL, the capture instant to the millisecond, a one-line
  note and an accessibility snapshot. Every one of the 122 `.jpg` files in that directory is listed
  in it exactly once, and every entry resolves to a file that exists. That is why those 122 files
  carry a description below without any record naming them one by one.
- `docs/evidence/ui-audit-2026-09-09/console-navigation.json` (271 bytes) holds the two instants of
  the console self-refresh probe behind UI-025, with `action_between: "none"`. It is referenced from
  `docs/ui-audit-2026-09-09.json`, not from a `.md` record.

One file is small enough to mention: `docs/evidence/b13-screens/statement-run-fold-explain-375.png`
is 2 808 bytes at 375x900. It is not empty and not corrupt: it is the frame of a mostly blank
narrow viewport captured while the fold was open, and it is one half of the F-B13-30 before/after
pair. No evidence file is zero bytes.

## `docs/evidence/live-integration-2026-09-09/` (18 files: 14 images, 4 text)

The provider-side proof of the two live slots, assembled on 2026-09-09 between 20:12Z and 20:23Z at
Yoann's request by a desktop session, and reviewed by an independent Codex reviewer at 20:27Z. It is
the only folder in the repository that carries its own integrity file, and the only one whose
descriptions were checked by a second model before landing.

**Verified for this pack, not taken on trust:**

- `shasum -a 256 -c SHA256SUMS.txt`: **14 of 14 OK**.
- The four "earlier capture" files are byte-identical to the sources they name, checked by md5
  against the rest of the tree: `01-kyb-approved-earlier-capture.jpg` to
  `ui-audit-2026-09-09/broker-kyb-approved.jpg`, `02-kyb-failed-earlier-capture.jpg` to
  `broker-kyb-failed.jpg`, `03-correction-and-ledger-earlier-capture.png` to
  `live-fire-day2/LIVE-8/after/policy-money.png`, `04-reconciliation-earlier-capture.png` to
  `live-fire-day2/LIVE-0/after/reconciliation.png`. Four of the nine duplicate groups in the tree
  are these, and they are declared copies, not accidents.
- `gitleaks dir` over the folder: no leaks. **But gitleaks cannot read pixels**, so two of the
  dashboard captures were opened and inspected for a visible key or signing secret. Neither shows
  one: Stripe keeps signing secrets behind the destination's own menu, which is not open in the
  capture.

**What the images prove.** Each is a Stripe dashboard capture carrying the sandbox banner "You're
testing in a sandbox. Changes you make here don't affect real customers or payments", which is AF-04
evidence from the provider rather than from us.

| File | What it shows |
|---|---|
| `02-Stripe-Connect-KYB/01-two-active-webhook-destinations.jpg` | **The single strongest AF-02 image.** Two ACTIVE event destinations, both on the exact deployed URL `https://corgi-work-trial-iota.vercel.app/api/webhooks/stripe`: one from **Connected accounts** (1 event) and one from **Your account** (9 events), 0 % error rate on both. Opened for this pack |
| `01-Stripe-Payments/01-issuance-payment-succeeded.jpg` | `payment_intent.succeeded`, USD 1,253.20, the CGP-01707 issuance |
| `01-Stripe-Payments/02-issuance-webhook-delivered.jpg` | the same event delivered HTTP 200 to the deployed endpoint at 2026-09-08 18:57:00 UTC |
| `01-Stripe-Payments/03-issuance-webhook-response-done.jpg` | **the application's own answer, read from Stripe's side**: `200 OK` and a response body of `{"received": true, "status": "done"}`, beside `evt_3UDUCUK6R3v50tIy0MtOqkDo` and `pi_3UDUCUK6R3v50tIy06eM9VlU`. Opened for this pack |
| `01-Stripe-Payments/04-refund-2081-09-webhook-delivered.jpg` | `refund.updated` for USD 2,081.09 delivered HTTP 200 on 2026-09-08 at 18:27:59 UTC, refund `re_3UDN8aK6R3v50tIy0J6CmRy3` |
| `01-Stripe-Payments/05-refund-webhook-response-done.jpg` | the same delivery with `received: true`, `status: done` |
| `01-Stripe-Payments/06-correction-53-84-webhook-response-done.jpg` | the correction collection, USD 53.84, `pi_3UDrW1K6R3v50tIy1GPWqtve`, event `evt_3UDrW1K6R3v50tIy1YusKFe5`, delivered 2026-09-09 at 19:50:43 UTC, HTTP 200 and done |
| `02-Stripe-Connect-KYB/02-kyb-webhook-response-done.jpg` | the connected-account `account.updated` `evt_1UDOgLK6R3FpfF2DhpwJYnqR` delivered to the deployed endpoint, HTTP 200, done |
| `02-Stripe-Connect-KYB/03-kyb-webhook-event-and-account.jpg` | the same event tied visibly to connected account `acct_1UDOfRK6R3FpfF2D` and to the endpoint |
| `02-Stripe-Connect-KYB/04-harbor-point-restricted.jpg` | the Harbor Point test account as **Restricted**, payouts paused |
| `03-Deployed-Application/01` to `04` | four earlier application captures, byte-identical copies, declared as such: KYB approved, KYB failed, the correction and its ledger entries, the reconciliation board after the 18:38Z run |
| `evidence-manifest.json`, `SHA256SUMS.txt`, `00-START-HERE.md`, `REVIEW-NOTES.md` | the manifest with a SHA-256 and a capture instant per image, the checksum file, the reading guide, and the Codex review |

**What it does not claim, in its own words.** The bank verification and the claim payout rail are
`LOCAL SIMULATOR` and are "not claimed as live integration evidence". Stripe Connect is
"connected-business verification, not a dedicated KYB bureau". Stripe's account label **Restricted**
is a capability status and "is distinct from the app KYB decision". "A dashboard's HTTP response is
the application's reported processing result; it does not independently prove all ledger or security
invariants." **No capture of the transient KYB pending state is included**, and the guide says so
rather than implying the set is complete. The 2026-09-09 reconciliation capture "is included as an
operational view, not evidence of a clean reconciliation": it shows four breaks and 32 probes. One
earlier screen keeps a stale "to collect" badge beside its own collected confirmation, disclosed
rather than cropped out.

**Provenance and the cross-model review.** Collection was read-only at the provider: no payment,
refund, approval, replay, API key or sharing permission was created. The independent Codex reviewer
(`/root/evidence_pack_review`, 2026-09-09 20:27Z) decoded every image with Pillow, checked byte
sizes, dimensions, formats and the manifest, and reports **14 of 14 passed, 14 unique hashes, 12
JPEGs and 2 PNGs, none mislabeled**, and **4 of 4 byte-identical** for the earlier captures. Its
verdict, quoted: **"PASS for the local screenshot pack as prepared for Yoann's review."** It adds,
in the same sentence, that the verdict "does not complete B14, certify the product, approve hosting
or submission", which is the right scope for it and the reason this pack quotes it rather than
leaning on it.

## `docs/evidence/live-fire-day2/` (90 files, 5 step folders)

Tonight's live-fire session: Yoann clicks in the deployed interface, a co-pilot session computes the
expected figures **before** each click from the repository's own pure functions and reads the result
**after** it by GET, signed in as the demo roles. That session never submits a form on production
and never calls a money route. Record: `docs/handoffs/live-fire-day2.md`.

Each step folder holds `before/` and `after/`. **The `.txt` files are the evidence** and the `.png`
files illustrate them, which is why the counting rule above counts text files.

| Step | Files | What Yoann did | Live-fire item |
|---|---|---|---|
| `LIVE-0/` | 14 | the reconciliation run at 18:38:23Z and the Redwood September statement at 18:45:13Z | closes F-BP-01, and F-INT-04 |
| `LIVE-8/` | 20 | the **backdated correction** of CGP-01707, moving the endorsement from 2026-10-08 to 2026-09-22, recorded 19:33:07Z | **LF-2** |
| `LIVE-9/` | 15 | the **second endorsement** ($2,400 to $2,700, effective 2026-10-01) and **three as-of dates** | **LF-5** |
| `LIVE-7/` | 15 | the **cancellation of CGP-01707 with an open claim**, four refunds above the threshold through the approval queue | **LF-4**, and LF-7 observed |
| `LIVE-3/` | 26 | **broker KYB live on Stripe Connect**: one approved, one failed, binding refused until approved | the KYB slot, live |


## `docs/evidence/b12-1/` (4 files)

The rehearsed live MCP agent demonstration of 2026-09-08. Descriptions are the ones `docs/handoffs/b12-1-agent-demo.md` section 9 gives.

| File | Size | Pixels | What it shows |
|---|---|---|---|
| `01-inspector-connected.png` | 202 KB | 2880x2000 | MCP Inspector 2.5.0 connected to the production endpoint over Streamable HTTP, protocol MCP 2025-11-25, INITIALIZE 312 ms OK and TOOLS/LIST 168 ms OK in the message log |
| `02-inspector-tools-list.png` | 205 KB | 2880x2000 | the five tools as a real client lists them |
| `03-approvals-agent-raised-waiting.png` | 892 KB | 2560x6034 | `/ops/approvals` as approver@example.com at `5f2c841`: the $1,200.00 request, Raised by an AGENT with the key prefix, the canonical intent and its sha256, Approve and Reject |
| `04-approvals-agent-raised-rejected.png` | 634 KB | 2560x3296 | `/ops/approvals` as ops@example.com at `c5bcf2a`: nothing waiting, the request in Already decided with the agent pill and the rejection reason |

## `docs/evidence/b12-4/` (18 files)

The animated explanation (B12-4). Captured by the builder on a throwaway fixture, deleted before the commit; no reviewer ran the animation in a browser, and `docs/reviews/inbox-and-motion.md` says so.

| File | Size | Pixels | What it shows |
|---|---|---|---|
| `fragment-arrival-opens-the-fold.png` | 58 KB | 900x940 | arrival at a fragment: the fold opened, the entry lit, the connector drawn |
| `hidden-0000ms-at-rest.png` | 24 KB | 900x940 | F-B12-11: the proving entry sitting behind the journal's show-all fold (rest) |
| `hidden-1400ms.png` | 102 KB | 900x940 | F-B12-11: the proving entry sitting behind the journal's show-all fold (1400ms) |
| `hidden-after-trace-to-the-ledger.png` | 96 KB | 900x940 | F-B12-11: the proving entry sitting behind the journal's show-all fold |
| `motion-0000ms-at-rest.png` | 50 KB | 900x940 | a frame of the reveal and the 600 ms count-up (rest) |
| `motion-0140ms.png` | 27 KB | 900x940 | a frame of the reveal and the 600 ms count-up (0140ms) |
| `motion-0280ms.png` | 52 KB | 900x940 | a frame of the reveal and the 600 ms count-up (0280ms) |
| `motion-0420ms.png` | 62 KB | 900x940 | a frame of the reveal and the 600 ms count-up (0420ms) |
| `motion-0560ms.png` | 95 KB | 900x940 | a frame of the reveal and the 600 ms count-up (0560ms) |
| `motion-0760ms.png` | 103 KB | 900x940 | a frame of the reveal and the 600 ms count-up (0760ms) |
| `motion-1000ms.png` | 103 KB | 900x940 | a frame of the reveal and the 600 ms count-up (1000ms) |
| `motion-1400ms.png` | 102 KB | 900x940 | a frame of the reveal and the 600 ms count-up (1400ms) |
| `motion-2200ms.png` | 102 KB | 900x940 | a frame of the reveal and the 600 ms count-up (2200ms) |
| `reduced-0000ms-at-rest.png` | 52 KB | 900x1500 | F-B12-16, prefers-reduced-motion: the finished state at once, no count-up, no connector (rest) |
| `reduced-0140ms.png` | 139 KB | 900x1500 | F-B12-16, prefers-reduced-motion: the finished state at once, no count-up, no connector (0140ms) |
| `reduced-1400ms.png` | 139 KB | 900x1500 | F-B12-16, prefers-reduced-motion: the finished state at once, no count-up, no connector (1400ms) |
| `visible-0000ms-at-rest.png` | 52 KB | 900x1500 | both ends of the connector on screen, 900x1500 (rest) |
| `visible-1400ms.png` | 141 KB | 900x1500 | both ends of the connector on screen, 900x1500 (1400ms) |

## `docs/evidence/b13-13-ui-audit/` (30 files)

One PNG per desktop-audit issue, named by issue id, plus five 375 px and regression frames the record adds. Titles are the audit's own, from `docs/ui-audit-2026-09-09.json`.

| File | Size | Pixels | What it shows |
|---|---|---|---|
| `375-journal-entry-clipped.png` | 78 KB | 375x900 | F-UA-04: at 375 px the journal entry table is clipped, 363 px cut with no scroller |
| `375-policy-folds-open.png` | 55 KB | 375x800 | the policy page at 375 px with folds open, scrollWidth equal to innerWidth |
| `375-reconciliation.png` | 52 KB | 375x800 | reconciliation at 375 px, no sideways scroll |
| `375-statements.png` | 50 KB | 375x800 | statements at 375 px, no sideways scroll |
| `regressions-inbox-ops.png` | 126 KB | 1512x800 | the regression sweep of the inbox and the operations screens after the three cycles |
| `ui-003-login-closed.png` | 88 KB | 1512x800 | **P2 UI-003**: Expanding demo-account help changes the width and position of the entire login layout |
| `ui-003-login-open.png` | 111 KB | 1512x800 | **P2 UI-003**: Expanding demo-account help changes the width and position of the entire login layout |
| `ui-004-broker-still-2481.png` | 92 KB | 1512x800 | **P2 UI-004**: The policy-list total uses future terms while its help describes today's terms |
| `ui-004-ops-policies-1253.png` | 102 KB | 1512x800 | **P2 UI-004**: The policy-list total uses future terms while its help describes today's terms |
| `ui-006-claim-payments.png` | 130 KB | 1512x800 | **P2 UI-006**: The Payments table splits approval states and squeezes operational controls |
| `ui-007-explain-open.png` | 164 KB | 1512x800 | **P2 UI-007**: Opening an amount explanation creates very narrow, extremely tall cards |
| `ui-008-009-approvals.png` | 176 KB | 1512x800 | **P2 UI-008**: The pending and decided approval panels touch each other |
| `ui-011-reconciliation.png` | 184 KB | 1512x800 | **P2 UI-011**: The reconciliation table crushes labels and hides diagnostic columns on desktop |
| `ui-013-statements.png` | 103 KB | 1512x800 | **P2 UI-013**: The statements table shows only its left-hand columns and breaks broker names into fragments |
| `ui-014-statement-movements.png` | 210 KB | 1512x800 | **P2 UI-014**: Long movement explanations become narrow towers in the statement table |
| `ui-016-inbox-first-viewport.png` | 126 KB | 1512x800 | **P2 UI-016**: Large empty queues appear before the operations inbox's actual work |
| `ui-017-investigate-anchor.png` | 200 KB | 1512x800 | **P2 UI-017**: Investigate opens an unfiltered reconciliation list and loses the selected break |
| `ui-019-endorsement-schedule.png` | 168 KB | 1512x800 | **P2 UI-019**: The endorsement schedule splits words and currency amounts into fragments |
| `ui-019-header-collision-proof.png` | 171 KB | 1512x800 | **P2 UI-019**: The endorsement schedule splits words and currency amounts into fragments |
| `ui-021-sandbox-references-open.png` | 173 KB | 1512x800 | **P2 UI-021**: The endorsement's Sandbox references popover is clipped by the table boundary |
| `ui-022-voided-ops-zero.png` | 190 KB | 1512x800 | **P1 UI-022**: A voided local payment is still summarized as collected and refunded at Stripe |
| `ui-023-endorse-preview-of-defaults.png` | 117 KB | 1512x800 | **P2 UI-023**: The prefilled endorsement date is rejected and the error screen removes the form |
| `ui-024-correction-preview.png` | 119 KB | 1512x800 | **P1 UI-024**: Correction-preview labels render nearly one letter per line |
| `ui-025-still-on-ops-after-25s.png` | 111 KB | 1512x800 | **P1 UI-025**: Console refresh returns the user to Console after they navigate away |
| `ui-026-console-errors.png` | 230 KB | 1512x800 | **P2 UI-026**: The console error table breaks labels into tiny fragments and clips Recovery |
| `ui-029-console-search-claim.png` | 121 KB | 1512x800 | **P2 UI-029**: Search results fragment even short field names and squeeze the Open links |
| `ui-030-console-360-policy.png` | 151 KB | 1512x800 | **P2 UI-030**: Money-operation and timeline columns are unreadably narrow across the 360 views |
| `ui-031-broker2-what-needs-you.png` | 92 KB | 1512x800 | **P2 UI-031**: The broker is told nothing needs attention while verification blocks binding |
| `ui-034-035-customer-list.png` | 84 KB | 1512x800 | **P1 UI-034**: The customer policy list has no link to the policy detail or change-request form |
| `ui-036-voided-customer.png` | 134 KB | 1512x800 | **P2 UI-036**: The voided customer policy labels its fallback figures as terms in force |

## `docs/evidence/b13-14-low-screens/` (12 files)

The LOW screens sweep confirmation. The record names five of these by filename; its AF-05 line states that all twelve were opened and reviewed.

| File | Size | Pixels | What it shows |
|---|---|---|---|
| `b1334-policy-chips.png` | 141 KB | 1512x640 | F-B13-34: the per-slot mode chips on the policy detail |
| `int20-console-360.png` | 62 KB | 1500x300 | F-INT-20 as fixed on the console 360 operations table, read beside `lu01-console-timeline.png` |
| `int23-endorse-preview.png` | 125 KB | 1512x950 | F-INT-23: the endorsement preview wording |
| `lu01-console-timeline.png` | 44 KB | 1500x200 | **the FAIL of this round, F-LU-01**: the 360 timeline prints a green succeeded chip beside "Your card was declined.", dated with the success instant 2026-09-08 10:16:02 while the decline happened at 10:00:19 |
| `pp07-broker-error.png` | 43 KB | 1512x420 | F-PP-07: the notice shape on `/broker?error=x` |
| `pp07-ops-error.png` | 62 KB | 1512x420 | F-PP-07: the same notice shape on `/ops?error=x`, x=305 and width 1150 on both |
| `ua01-broker-list.png` | 143 KB | 1512x950 | F-UA-01 closed: the broker list on today's terms |
| `ua01-ops-policies.png` | 104 KB | 1512x950 | F-UA-01: the operations list, identical cell for cell to the broker list |
| `ua03-endorsement-schedule.png` | 37 KB | 768x288 | F-UA-03: the endorsement schedule columns |
| `ua04-journal-375-scrolled.png` | 58 KB | 375x900 | F-LU-02: the same block scrolled fully right, the account column gone with the labels |
| `ua04-journal-375.png` | 74 KB | 375x900 | F-LU-02: at 375 px the words debit and credit occur zero times on the whole page |
| `ua05-ops-approvals.png` | 191 KB | 1512x950 | F-UA-05: the approvals screen. Shows an MCP key **prefix**, which is what the application prints for every operator, plus two sha256 digests and a Stripe test id |

## `docs/evidence/b13-screens/` (38 files)

Three key screens by five states by two widths, plus the four frames that carry F-B13-30 before and after. The record keeps both the overflowing and the fixed frames on purpose.

| File | Size | Pixels | What it shows |
|---|---|---|---|
| `policy-default-1280.png` | 218 KB | 1280x4602 | policy detail with as-of, the nominal state on real trial data, at 1280 px |
| `policy-default-375.png` | 156 KB | 375x6700 | policy detail with as-of, the nominal state on real trial data, at 375 px |
| `policy-edge-1280.png` | 57 KB | 1280x1000 | policy detail with as-of, the edge state, at 1280 px |
| `policy-edge-375.png` | 24 KB | 375x900 | policy detail with as-of, the edge state, at 375 px |
| `policy-empty-1280.png` | 85 KB | 1280x1000 | policy detail with as-of, the empty state, at 1280 px |
| `policy-empty-375.png` | 25 KB | 375x900 | policy detail with as-of, the empty state, at 375 px |
| `policy-error-1280.png` | 54 KB | 1280x1000 | policy detail with as-of, the error state, at 1280 px |
| `policy-error-375.png` | 23 KB | 375x900 | policy detail with as-of, the error state, at 375 px |
| `policy-error-wrong-id-1280.png` | 16 KB | 1280x1000 | policy detail with as-of, the error state, a wrong policy id, at 1280 px |
| `policy-error-wrong-id-375.png` | 13 KB | 375x900 | policy detail with as-of, the error state, a wrong policy id, at 375 px |
| `policy-fold-explain-375.png` | 28 KB | 375x900 | **before the fix**: one click on Explain this amount scrolls the page sideways at 375 px (F-B13-30) |
| `policy-foldfixed-explain-375.png` | 67 KB | 375x900 | **after the F-B13-30 fix**: the explanation fold open at 375 px, scrollWidth equal to innerWidth |
| `policy-loading-1280.png` | 39 KB | 1280x1000 | policy detail with as-of, the loading state, at 1280 px |
| `policy-loading-375.png` | 23 KB | 375x900 | policy detail with as-of, the loading state, at 375 px |
| `reconciliation-default-1280.png` | 411 KB | 1280x23364 | reconciliation breaks, the nominal state on real trial data, at 1280 px |
| `reconciliation-default-375.png` | 199 KB | 375x15423 | reconciliation breaks, the nominal state on real trial data, at 375 px |
| `reconciliation-edge-1280.png` | 42 KB | 1280x1000 | reconciliation breaks, the edge state, at 1280 px |
| `reconciliation-edge-375.png` | 17 KB | 375x900 | reconciliation breaks, the edge state, at 375 px |
| `reconciliation-empty-1280.png` | 31 KB | 1280x1000 | reconciliation breaks, the empty state, at 1280 px |
| `reconciliation-empty-375.png` | 15 KB | 375x900 | reconciliation breaks, the empty state, at 375 px |
| `reconciliation-error-1280.png` | 416 KB | 1280x23462 | reconciliation breaks, the error state, at 1280 px |
| `reconciliation-error-375.png` | 202 KB | 375x15544 | reconciliation breaks, the error state, at 375 px |
| `reconciliation-loading-1280.png` | 70 KB | 1280x1000 | reconciliation breaks, the loading state, at 1280 px |
| `reconciliation-loading-375.png` | 23 KB | 375x900 | reconciliation breaks, the loading state, at 375 px |
| `statement-default-1280.png` | 65 KB | 1280x1414 | broker statement, the nominal state on real trial data, at 1280 px |
| `statement-default-375.png` | 38 KB | 375x1760 | broker statement, the nominal state on real trial data, at 375 px |
| `statement-default-run-1280.png` | 207 KB | 1280x8639 | broker statement, the nominal state on real trial data on the statement run page, at 1280 px |
| `statement-default-run-375.png` | 106 KB | 375x5331 | broker statement, the nominal state on real trial data on the statement run page, at 375 px |
| `statement-edge-1280.png` | 66 KB | 1280x1000 | broker statement, the edge state, at 1280 px |
| `statement-edge-375.png` | 33 KB | 375x900 | broker statement, the edge state, at 375 px |
| `statement-empty-1280.png` | 76 KB | 1280x1106 | broker statement, the empty state, at 1280 px |
| `statement-empty-375.png` | 62 KB | 375x2663 | broker statement, the empty state, at 375 px |
| `statement-error-1280.png` | 16 KB | 1280x1000 | broker statement, the error state, at 1280 px |
| `statement-error-375.png` | 13 KB | 375x900 | broker statement, the error state, at 375 px |
| `statement-loading-1280.png` | 5 KB | 1280x1000 | broker statement, the loading state, at 1280 px |
| `statement-loading-375.png` | 23 KB | 375x900 | broker statement, the loading state, at 375 px |
| `statement-run-fold-explain-375.png` | 3 KB | 375x900 | **before the fix**: one click on Explain this amount scrolls the page sideways at 375 px (F-B13-30) |
| `statement-run-foldfixed-explain-375.png` | 60 KB | 375x900 | **after the F-B13-30 fix**: the explanation fold open at 375 px, scrollWidth equal to innerWidth |

## `docs/evidence/pdf/` (13 files)

The PDF quality pass: every page of the three documents plus the edge cases. Three PDFs are kept beside their rendered pages so a reviewer can open the real file. Rendering is deterministic, proven with `cmp` on a double render.

| File | Size | Pixels | What it shows |
|---|---|---|---|
| `declarations-POL-2028-000001-as-of-2028-10-01-1.png` | 175 KB | 935x1210 | the declarations page as of 2028-10-01, page 1 rendered |
| `declarations-POL-2028-000001-as-of-2028-10-01.pdf` | 8 KB | - | the declarations page as of 2028-10-01, the PDF itself |
| `edge-declarations-no-endorsements-1.png` | 160 KB | 935x1210 | edge case: a declarations page for a policy with no endorsement |
| `edge-declarations-real-address-cancelled-1.png` | 185 KB | 935x1210 | edge case: a cancelled policy with a long real address |
| `edge-schedule-no-endorsements-1.png` | 112 KB | 1210x935 | edge case: an endorsement schedule with no endorsement |
| `edge-statement-empty-1.png` | 168 KB | 935x1210 | edge case: an empty statement |
| `edge-statement-v1-provisional-long-1.png` | 249 KB | 935x1210 | edge case: a long provisional format-1 statement, page 1 |
| `edge-statement-v1-provisional-long-2.png` | 247 KB | 935x1210 | edge case: a long provisional format-1 statement, page 2 |
| `edge-statement-v1-provisional-long-3.png` | 118 KB | 935x1210 | edge case: a long provisional format-1 statement, page 3 |
| `endorsement-schedule-POL-2028-000001-as-of-2028-10-01-1.png` | 126 KB | 1210x935 | the endorsement schedule as of 2028-10-01, page 1 rendered |
| `endorsement-schedule-POL-2028-000001-as-of-2028-10-01.pdf` | 6 KB | - | the endorsement schedule as of 2028-10-01, the PDF itself |
| `statement-2028-03-revision-2-1.png` | 185 KB | 935x1210 | the broker statement for 2028-03, revision 2, page 1 rendered |
| `statement-2028-03-revision-2.pdf` | 7 KB | - | the broker statement for 2028-03, revision 2, the PDF itself |

## `docs/evidence/ui-cycle-2/` (24 files)

The independent measurement of interface cycle 2. **Six of these files were recaptured** to
close F-UI2-08; the recaptured six illustrate `92379e2` and the other eighteen `c408cb3`, which
is stated per row below and in the record's own section 11. All 24 md5 values are distinct, and
the record's md5 table was checked against the files for this pack: 24 rows, 24 files, zero
mismatch.

| File | Size | Pixels | md5 | Revision | What it shows |
|---|---|---|---|---|---|
| `1024-console-submenu.png` | 164 KB | 1024x900 | `55bdc9bd` | c408cb3 | the console with its submenu at 1024 px, no overlap |
| `1440-console-submenu.png` | 238 KB | 1440x900 | `fd31f5ed` | c408cb3 | the same at 1440 px |
| `375-console-ledger.png` | 62 KB | 375x900 | `9b38866b` | c408cb3 | the console ledger section at 375 px, every fold open |
| `375-console.png` | 62 KB | 375x900 | `2b878208` | c408cb3 | the console at 375 px, every fold open |
| `375-explain-policy.png` | 59 KB | 375x900 | `2239a0f6` | c408cb3 | the explanation drawer open on the policy page at 375 px |
| `375-inbox.png` | 78 KB | 375x900 | `9bc2e8a9` | c408cb3 | the inbox at 375 px |
| `375-policy.png` | 75 KB | 375x900 | `0e976944` | c408cb3 | the policy page at 375 px, every fold open |
| `375-reconciliation.png` | 65 KB | 375x900 | `7701bec5` | c408cb3 | the reconciliation board at 375 px |
| `375-statements.png` | 66 KB | 375x900 | `b56525fe` | c408cb3 | the statements screen at 375 px |
| `anon-landing.png` | 130 KB | 1440x900 | `bcba9706` | c408cb3 | the signed-out landing page and its sandbox sentence |
| `anon-login.png` | 39 KB | 1440x900 | `75f8017f` | c408cb3 | the sign-in page and its sandbox sentence |
| `approvals.png` | 97 KB | 1440x950 | `0abd220a` | 92379e2, recaptured | **recaptured**: Money-out approvals as `ops@`, the three tiles (Waiting 0, Amount waiting $0.00, Agent raised 1), the mode line, the Waiting view empty. Opened for this pack |
| `claim-payments.png` | 176 KB | 1440x950 | `c967444f` | 92379e2, recaptured | **recaptured**: the claim payments table with `LOCAL SIMULATOR` on its rows |
| `endorse-preview.png` | 184 KB | 1440x950 | `2e0be5ea` | 92379e2, recaptured | **recaptured**: the endorsement preview, a GET form that computes and writes nothing |
| `explain-drawer.png` | 232 KB | 1440x950 | `46bfa8f4` | c408cb3 | the amount explanation as a right-hand drawer |
| `inbox-broker.png` | 60 KB | 1440x950 | `bb599e07` | c408cb3 | the broker inbox |
| `inbox-ops.png` | 321 KB | 1440x2949 | `c847bf9a` | c408cb3 | the operations inbox |
| `mcp-keys.png` | 788 KB | 1440x3415 | `c2ab53a8` | c408cb3 | the MCP provider page: endpoint, header, snippet, the tool list read from the code, the never-delegated list, key prefixes only |
| `new-broker.png` | 153 KB | 1440x1086 | `1eef7f40` | c408cb3 | the New broker card rendered disabled with its route-pending sentence |
| `recon-approver.png` | 148 KB | 1440x950 | `0653edca` | c408cb3 | the reconciliation board as `approver@`, with no explain control |
| `recon-explained.png` | 58 KB | 1180x700 | `81e0df1d` | c408cb3 | **the F-BP-02 evidence, at `c408cb3`**: the Explained breaks table with `pi_3UDQN7K6R3v50tIy0fdlIi1Q`, classification `provider only`, the note, `Sam Patel, operations`, `2026-09-09 16:39:11`. Opened for this pack |
| `recon-ops-board.png` | 492 KB | 1440x3326 | `aa7b34de` | 92379e2, recaptured | **recaptured**: the breaks board as `ops@`. Opened for this pack: the band reads `4 breaks to act on` and `32 probes from check runs`, the four remaining breaks are the $100.00, the two $12.61 and the -$8.98, the probe table lists 32 rows of $42.42, and the Explained breaks table is empty. See section 4.3 |
| `recon-runs.png` | 191 KB | 1440x950 | `1ff0e033` | 92379e2, recaptured | **recaptured**: the runs list, whose latest Stripe row reads `32 probes, 4 breaks to act on` |
| `reference-drawer.png` | 209 KB | 1440x950 | `363fe653` | 92379e2, recaptured | **recaptured**: the inspector drawer opened by following a link the page itself renders (`?inspect=pi_3UDKjJK6R3v50tIy0nLbDPOc`). The first version was signed in and genuine but showed the drawer refusing a hand-typed shape, the opposite of what the record claims |

## `docs/evidence/ui-audit-2026-09-09/` (124 files)

The desktop UI and branding audit of 2026-09-09, 09:12Z to 09:52Z. The `ref-*` captures are
of the connected Corgi portal, used as the branding reference; every other capture is of the
deployed application. Notes and capture instants are the audit's own, from `observations.json`.

| File | Size | Pixels | Captured (UTC) | What it shows |
|---|---|---|---|---|
| `approval-intent.jpg` | 88 KB | 1512x698 | 2026-09-09T09:17:44.277 | Approved intent disclosure expanded |
| `approver-overview.jpg` | 72 KB | 1512x698 | 2026-09-09T09:37:20.906 | Approver home; no approval action performed |
| `approver-queue.jpg` | 85 KB | 1512x698 | 2026-09-09T09:37:21.577 | Approver role with an empty pending queue |
| `broker-failed-overview.jpg` | 51 KB | 1512x698 | 2026-09-09T09:33:36.933 | Failed broker overview |
| `broker-inbox.jpg` | 41 KB | 1512x698 | 2026-09-09T09:33:12.943 | Broker empty inbox |
| `broker-kyb-approved.jpg` | 70 KB | 1512x698 | 2026-09-09T09:32:17.061 | Approved broker verification screen |
| `broker-kyb-failed.jpg` | 62 KB | 1512x580 | 2026-09-09T09:33:37.595 | Failed verification state and resubmission form |
| `broker-kyb-help.jpg` | 97 KB | 1512x698 | 2026-09-09T09:32:26.196 | All verification help disclosures expanded |
| `broker-kyb-resubmit-lower.jpg` | 65 KB | 1512x698 | 2026-09-09T09:33:58.150 | Verification agreement and form controls, untouched |
| `broker-new-policy-lower.jpg` | 47 KB | 1512x698 | 2026-09-09T09:32:16.274 | Monetary inputs and Create draft action; no draft created |
| `broker-new-policy.jpg` | 48 KB | 1512x698 | 2026-09-09T09:32:07.822 | New policy form before preview |
| `broker-overview.jpg` | 53 KB | 1512x698 | 2026-09-09T09:32:00.273 | Approved broker home |
| `broker-statements-empty.jpg` | 44 KB | 1512x698 | 2026-09-09T09:34:11.927 | Broker with no statements, after image load |
| `broker-statements-help.jpg` | 88 KB | 1512x698 | 2026-09-09T09:32:41.962 | Statement list explanation |
| `broker-statements.jpg` | 63 KB | 1512x698 | 2026-09-09T09:32:27.029 | Broker statement list |
| `broker3-kyb.jpg` | 73 KB | 1512x698 | 2026-09-09T09:34:22.837 | Third broker current verification status; no new submission |
| `broker3-overview.jpg` | 46 KB | 1512x698 | 2026-09-09T09:34:22.133 | Third broker current status |
| `cancel-preview-default.jpg` | 66 KB | 1512x698 | 2026-09-09T09:21:26.717 | Cancellation preview from default date, no confirmation |
| `claim-detail.jpg` | 89 KB | 1512x698 | 2026-09-09T09:16:31.634 | Claim detail initial state |
| `claim-explanation.jpg` | 79 KB | 1512x698 | 2026-09-09T09:16:45.624 | Paid amount explanation expanded |
| `claim-intake.jpg` | 61 KB | 1512x698 | 2026-09-09T09:23:02.738 | Claim intake form, no submission |
| `claim-lower.jpg` | 78 KB | 1512x698 | 2026-09-09T09:16:59.038 | Claim payments, reserve history and forms after closing explanation |
| `claim-payments-actions.jpg` | 71 KB | 1512x698 | 2026-09-09T09:16:46.183 | Claim payments and action forms |
| `claim-simulator-menu.jpg` | 90 KB | 1512x698 | 2026-09-09T09:17:23.611 | Simulator submenu opened without executing actions |
| `console-broker.jpg` | 87 KB | 1512x698 | 2026-09-09T09:31:16.642 | Broker 360 |
| `console-claim-durations.jpg` | 102 KB | 1512x754 | 2026-09-09T09:30:46.013 | Expanded timing explanation |
| `console-claim-scope.jpg` | 108 KB | 1512x754 | 2026-09-09T09:30:47.110 | Expanded page scope explanation |
| `console-claim-webhooks.jpg` | 94 KB | 1512x754 | 2026-09-09T09:30:46.613 | Expanded webhook association explanation |
| `console-claim.jpg` | 92 KB | 1512x754 | 2026-09-09T09:30:29.632 | Claim 360 summary |
| `console-customer-timeline.jpg` | 57 KB | 1512x698 | 2026-09-09T09:31:30.538 | Customer timeline and disclosures |
| `console-customer.jpg` | 83 KB | 1512x698 | 2026-09-09T09:31:30.200 | Customer 360 |
| `console-errors-help.jpg` | 107 KB | 1512x754 | 2026-09-09T09:29:14.366 | Expanded error definitions |
| `console-errors.jpg` | 99 KB | 1512x754 | 2026-09-09T09:29:13.994 | Errors table at desktop width |
| `console-feed-recheck.jpg` | 93 KB | 1512x698 | 2026-09-09T09:52:27.694 | Closing recheck after deployment a1e525ddd02e. |
| `console-feed.jpg` | 102 KB | 1512x754 | 2026-09-09T09:28:52.633 | Default operations console |
| `console-filters.jpg` | 99 KB | 1512x754 | 2026-09-09T09:29:14.748 | Feed filters and source definitions |
| `console-help.jpg` | 105 KB | 1512x698 | 2026-09-09T09:43:41.953 | Console documentation disclosures opened |
| `console-infrastructure-help.jpg` | 64 KB | 1512x698 | 2026-09-09T09:43:42.851 | Infrastructure explanation disclosure |
| `console-infrastructure-lower.jpg` | 113 KB | 1512x754 | 2026-09-09T09:30:00.646 | Activity table and documented-limit sidebar |
| `console-infrastructure.jpg` | 119 KB | 1512x754 | 2026-09-09T09:29:51.454 | Infrastructure overview and details |
| `console-navigation-after.jpg` | 102 KB | 1512x754 | 2026-09-09T09:29:49.921 | No navigation click after Overview; page automatically returned to Console. |
| `console-navigation-before.jpg` | 78 KB | 1512x754 | 2026-09-09T09:29:28.235 | Clicked Overview from Console; no further navigation will be performed for 12 seconds. |
| `console-navigation.json` | 271 B | - | - | the two instants of the console self-refresh probe behind UI-025, with action_between none |
| `console-policy-recheck.jpg` | 80 KB | 1512x698 | 2026-09-09T09:52:20.427 | Closing recheck of UI-027 after deployment a1e525ddd02e. |
| `console-policy.jpg` | 81 KB | 1512x698 | 2026-09-09T09:25:01.890 | Policy 360 view |
| `console-search-claim.jpg` | 86 KB | 1512x754 | 2026-09-09T09:30:10.500 | Claim lookup trail includes policy CGP-01707 endorsement rows |
| `console-search-help.jpg` | 65 KB | 1512x698 | 2026-09-09T09:31:39.902 | Search interpretation disclosure |
| `console-search-no-match.jpg` | 74 KB | 1512x698 | 2026-09-09T09:31:31.668 | No-match search for synthetic unused policy number |
| `console-search-policy.jpg` | 79 KB | 1512x698 | 2026-09-09T09:24:49.802 | Search result for CGP-01707 |
| `console-search.jpg` | 66 KB | 1512x698 | 2026-09-09T09:24:41.460 | Reference search initial state |
| `correction-form.jpg` | 88 KB | 1512x698 | 2026-09-09T09:23:01.251 | Standalone correction form |
| `correction-preview.jpg` | 55 KB | 1512x698 | 2026-09-09T09:22:47.470 | Read-only correction preview for 2026-09-17 |
| `customer-cancelled-policy.jpg` | 79 KB | 1512x698 | 2026-09-09T09:37:06.769 | Cancelled policy viewed as customer |
| `customer-change-request.jpg` | 80 KB | 1512x698 | 2026-09-09T09:36:04.236 | Change request form without submission |
| `customer-inbox.jpg` | 41 KB | 1512x698 | 2026-09-09T09:36:50.415 | Customer empty approval inbox |
| `customer-overview-recheck.jpg` | 56 KB | 1512x698 | 2026-09-09T09:52:39.838 | Closing recheck of current terms after deployment a1e525ddd02e. |
| `customer-overview.jpg` | 57 KB | 1512x698 | 2026-09-09T09:35:47.581 | Customer home after image load; policy numbers are plain text |
| `customer-policy-help.jpg` | 93 KB | 1512x698 | 2026-09-09T09:36:05.196 | Customer policy explanation disclosures |
| `customer-policy-recheck.jpg` | 89 KB | 1512x698 | 2026-09-09T09:52:50.335 | Closing recheck of UI-035 after deployment a1e525ddd02e. |
| `customer-policy-schedule.jpg` | 94 KB | 1512x698 | 2026-09-09T09:36:03.923 | Customer endorsement schedule and cost explanation |
| `customer-policy-voided.jpg` | 80 KB | 1512x698 | 2026-09-09T09:36:05.643 | Voided policy viewed as customer |
| `customer-policy.jpg` | 85 KB | 1512x698 | 2026-09-09T09:35:48.093 | Known policy URL opened directly as its customer |
| `customer-voided-recheck.jpg` | 86 KB | 1512x698 | 2026-09-09T09:52:51.686 | Closing recheck of UI-036 after deployment a1e525ddd02e. |
| `customer2-overview.jpg` | 49 KB | 1512x698 | 2026-09-09T09:37:06.293 | Second customer with a cancelled policy |
| `endorsement-preview-default.jpg` | 42 KB | 1512x698 | 2026-09-09T09:20:47.538 | Preview with untouched form defaults; no recording confirmed |
| `endorsement-preview-valid.jpg` | 78 KB | 1512x698 | 2026-09-09T09:21:03.229 | Read-only endorsement preview with USD 3000 effective 2026-10-08 |
| `final-deployment-recheck.jpg` | 108 KB | 1512x698 | 2026-09-09T09:52:12.673 | Desktop audit closing recheck after a concurrent deployment. |
| `inbox-breaks.jpg` | 100 KB | 1512x698 | 2026-09-09T09:19:37.894 | Open reconciliation tasks in the inbox |
| `inbox-investigate-destination.jpg` | 94 KB | 1512x698 | 2026-09-09T09:19:49.966 | Clicking the last inbox break opens the unfiltered reconciliation page at the first break |
| `login-current-expanded.jpg` | 58 KB | 1512x698 | 2026-09-09T09:44:29.363 | Login on later deployment after expanding demo account help |
| `login-current.jpg` | 47 KB | 1512x698 | 2026-09-09T09:44:26.202 | Login on the later observed deployment before expanding help |
| `login-demo-menu.jpg` | 60 KB | 1512x698 | 2026-09-09T09:31:51.435 | Expanded demo accounts disclosure; no credentials filled |
| `login.jpg` | 47 KB | 1512x698 | 2026-09-09T09:31:41.020 | Sign-in form before entering credentials |
| `mcp-keys-table.jpg` | 110 KB | 1512x698 | 2026-09-09T09:19:19.369 | MCP key table and form footnote |
| `not-found.jpg` | 22 KB | 1506x698 | 2026-09-09T09:40:01.302 | Deliberately opened an absent path to inspect the 404 screen |
| `observations.json` | 1444 KB | - | - | the index of the 122 captures: id, URL, capture instant, note and accessibility snapshot |
| `ops-approvals.jpg` | 86 KB | 1512x698 | 2026-09-09T09:17:33.366 | Operations approval queue |
| `ops-brokers-help.jpg` | 105 KB | 1512x698 | 2026-09-09T09:15:55.935 | Broker verification help expanded |
| `ops-brokers.jpg` | 90 KB | 1512x698 | 2026-09-09T09:15:29.046 | Broker verification list |
| `ops-claims.jpg` | 48 KB | 1512x698 | 2026-09-09T09:16:11.130 | Operations claims list |
| `ops-inbox.jpg` | 58 KB | 1512x698 | 2026-09-09T09:19:28.054 | Operations inbox |
| `ops-mcp-keys.jpg` | 73 KB | 1512x698 | 2026-09-09T09:19:10.009 | MCP key management, no keys created or revoked |
| `ops-overview-lower.jpg` | 78 KB | 1512x698 | 2026-09-09T09:14:53.498 | Overview lower panels after a full navigation |
| `ops-overview.jpg` | 73 KB | 1512x698 | 2026-09-09T09:13:55.709 | Overview reached through the console navigation |
| `ops-policies-help.jpg` | 86 KB | 1512x698 | 2026-09-09T09:15:22.487 | Policies help expanded |
| `ops-policies.jpg` | 66 KB | 1512x698 | 2026-09-09T09:15:06.674 | Operations policies list |
| `ops-reconciliation.jpg` | 94 KB | 1512x698 | 2026-09-09T09:17:47.792 | Reconciliation initial state |
| `ops-statements.jpg` | 87 KB | 1512x698 | 2026-09-09T09:18:23.128 | Statements index |
| `pdf-browser-block.jpg` | 17 KB | 1512x698 | 2026-09-09T09:36:49.203 | Browser displays ERR_BLOCKED_BY_CLIENT after the PDF form is submitted. PDF contents were not inspected; this is not attributed to an application defect. |
| `policy-asof-submit-stale.jpg` | 72 KB | 1512x698 | 2026-09-09T09:23:32.138 | Submitting the date form after choosing the October step returns to September 9 |
| `policy-asof.jpg` | 72 KB | 1512x698 | 2026-09-09T09:23:14.871 | Historical query for endorsement effective date |
| `policy-bound.jpg` | 99 KB | 1512x698 | 2026-09-09T09:20:21.937 | Bound policy detail |
| `policy-cancel.jpg` | 71 KB | 1512x698 | 2026-09-09T09:21:25.809 | Cancellation date form |
| `policy-cancelled.jpg` | 95 KB | 1512x698 | 2026-09-09T09:23:34.013 | Cancelled policy with an open claim |
| `policy-endorse.jpg` | 67 KB | 1512x698 | 2026-09-09T09:20:35.856 | Endorsement form |
| `policy-endorsement-explained.jpg` | 89 KB | 1512x698 | 2026-09-09T09:22:08.466 | Endorsement explanation details |
| `policy-fee-explanation.jpg` | 80 KB | 1512x698 | 2026-09-09T09:40:52.402 | The policy fee amount explanation at desktop width |
| `policy-refund-explanation.jpg` | 84 KB | 1512x698 | 2026-09-09T09:24:08.162 | Cancelled policy unearned-premium explanation |
| `policy-sandbox-references.jpg` | 81 KB | 1512x698 | 2026-09-09T09:40:53.432 | Expanded endorsement reference popover |
| `policy-schedule.jpg` | 97 KB | 1512x698 | 2026-09-09T09:40:53.026 | Endorsement schedule at desktop width |
| `policy-voided.jpg` | 115 KB | 1512x698 | 2026-09-09T09:24:39.402 | Voided policy default |
| `public-home.jpg` | 56 KB | 1512x698 | 2026-09-09T09:39:55.002 | Public landing page |
| `reconciliation-help-bottom.jpg` | 71 KB | 1512x698 | 2026-09-09T09:18:22.571 | Clearing and resolution explanations |
| `reconciliation-lower.jpg` | 54 KB | 1512x698 | 2026-09-09T09:18:03.059 | Reconciliation lower panels |
| `ref-billing.jpg` | 31 KB | 1256x698 | 2026-09-09T09:15:55.426 | Reference billing list |
| `ref-certificates.jpg` | 34 KB | 1256x698 | 2026-09-09T09:14:33.314 | Reference certificate list |
| `ref-claims-new.jpg` | 45 KB | 1256x698 | 2026-09-09T09:15:10.347 | Reference claim intake |
| `ref-claims.jpg` | 34 KB | 1256x698 | 2026-09-09T09:14:56.686 | Reference claims list |
| `ref-coverage.jpg` | 51 KB | 1256x746 | 2026-09-09T09:12:58.905 | Reference coverage default, main content only |
| `ref-documents.jpg` | 35 KB | 1256x698 | 2026-09-09T09:15:25.689 | Reference documents list |
| `ref-endorsements-add.jpg` | 35 KB | 1256x698 | 2026-09-09T09:14:29.716 | No active policy state after Add endorsements |
| `ref-endorsements.jpg` | 33 KB | 1256x698 | 2026-09-09T09:13:58.873 | Reference endorsement list |
| `ref-quotes.jpg` | 30 KB | 1256x698 | 2026-09-09T09:13:34.165 | Reference quote list, empty state |
| `sandbox-menu.jpg` | 117 KB | 1512x698 | 2026-09-09T09:24:39.930 | Shared sandbox disclosure opened |
| `statement-detail.jpg` | 96 KB | 1512x698 | 2026-09-09T09:18:42.904 | Published September statement |
| `statement-explanation-1.jpg` | 77 KB | 1512x698 | 2026-09-09T09:33:09.945 | Amount explanation 1 |
| `statement-explanation-2.jpg` | 77 KB | 1512x698 | 2026-09-09T09:33:10.529 | Amount explanation 2 |
| `statement-explanation-3.jpg` | 76 KB | 1512x698 | 2026-09-09T09:33:11.125 | Amount explanation 3 |
| `statement-explanation-4.jpg` | 80 KB | 1512x698 | 2026-09-09T09:33:11.717 | Amount explanation 4 |
| `statement-explanation-settled.jpg` | 83 KB | 1512x698 | 2026-09-09T09:33:09.251 | Cash explanation opened after values settled |
| `statement-explanation.jpg` | 88 KB | 1512x698 | 2026-09-09T09:18:55.653 | Statement cash explanation opened |
| `statement-help.jpg` | 91 KB | 1512x698 | 2026-09-09T09:32:55.947 | Statement explanations expanded |
| `statement-movements.jpg` | 82 KB | 1512x698 | 2026-09-09T09:32:54.410 | Statement movement table |
| `statement-revision-delta.jpg` | 67 KB | 1512x698 | 2026-09-09T09:32:56.274 | Revision delta and reproducibility information |

---

# 3. Live-fire steps performed by the candidate

Everything in this section was driven by Yoann himself on the deployed application, and every
figure is quoted from the `docs/STATUS.md` entry written when it happened. "Live by Yoann" is
established by `docs/reviews/recheck-day2.md` and by the live-fire table of
`docs/COMPLIANCE-MATRIX.md` section 4. Steps proven only by a check script or by an agent probe are
listed apart in section 4, because a control demonstrated is not the rehearsal the brief asks for.

## LF-1a, 2026-09-08 10:16Z: issue and pay with a test card, CGP-01062

Yoann paid **CGP-01062** on the deployed URL with a Stripe test card: $3,450.75 of premium,
California, effective 2026-10-01, **charge 355 684 cents**.

- `payment_intent.succeeded`: `evt_3UDM4KK6R3v50tIy0S6PIO4D` on `pi_3UDM4KK6R3v50tIy0F5xaBbu`,
  `livemode: false`.
- `checkout.session.completed` arrived after it: `evt_1UDM4MK6R3v50tIyurIo0iug`. Both stored once
  and processed once.
- Four journal entries posted once: cash 355 684, unearned premium 345 075, tax 8 109, fee 2 500,
  commission 51 761. Policy bound.
- The operation's lifecycle reads requested, provider_accepted, failed (an earlier simulated failure
  from the delegate's local run), succeeded, provider_accepted: every step an appended event.

This met the T+24h requirement (money moving on a live sandbox rail at the deployed URL) at T+4h26.

## LF-1b, 2026-09-08 11:24Z: a payment from a session the deployed application created, CGP-01274

Recorded as the fix for **F-B2-04**: the first live payment used a Checkout Session created by the
delegate's local server. Yoann created and paid a fresh draft on the deployed URL, so the whole
chain, session included, came from the deployment.

## LF-4, 2026-09-08 18:22Z to 18:28Z: cancel with an open claim, CGP-01274

Yoann drove it, the coordinator verified in the trial database and at Stripe. Policy CGP-01274,
term 2026-09-17 to 2027-09-17, $2,312.00 annual, with the **open claim CLM-00212** carrying a
$3,800 reserve and $1,200 already paid. Cancellation effective 2026-10-31.

| Line | Cents | Amount |
|---|---|---|
| Earned premium, 44 of 365 days | 27 870 | $278.70 |
| Unearned premium refunded | 203 330 | $2,033.30 |
| Tax returned, rounded to the customer | 4 779 | $47.79 |
| Fee returned (fully earned at issuance) | 0 | $0.00 |
| **Total refund** | **208 109** | **$2,081.09** |
| Commission clawback | 30 499 | $304.99 |
| Claim reserve, untouched | 380 000 | $3,800.00 |

Every line equalled the coordinator's hand calculation before the click.

- Confirmed 18:22:10Z: cancelled event effective 2026-10-31, `refund_requested` and
  `premium_earned_to_date` entries, refund operation `ef73b3e2` at 208 109 cents queued with
  approval request `70faaf94`.
- **Approved by a second human**, `approver@example.com`, at 18:25:28Z, intent hash
  `04cf55bd8856a905045bfc86db859655f8e26ee0e28e3a3f1bc35b5f06faf81b`.
- Sent as `ops@example.com`: Stripe refund **`re_3UDN8aK6R3v50tIy0J6CmRy3`** created 18:27:57Z,
  succeeded, 208 109 cents, test mode.
- Three webhooks reached the deployed application at 18:27:59Z: `refund.created`
  (`evt_3UDN8aK6R3v50tIy0vhuzzrF`), `refund.updated` (`evt_3UDN8aK6R3v50tIy0i0dxINg`) and
  `charge.refunded` (`evt_3UDN8aK6R3v50tIy0LSsG2XU`). `refund_completed` and `commission_clawback`
  posted at 18:27:59Z, effective 2026-09-08, the day the cash left Stripe.

This closed F-B5-04. **Not done in this step:** the refusal of the initiator on the approvals queue.
STATUS records at 18:30Z that the coordinator's instruction came in the wrong order and that it was
"to be done on the next refund"; it never was. See LF-7 in section 4.

## LF-1c, 2026-09-08 18:56Z to 18:57Z: the recited example, live, CGP-01707

Yoann issued and paid **CGP-01707** (Bay Area Fabrication LLC, `customer@example.com`, California,
term 2026-09-08 to 2027-09-08, $1,200.00 annual) with the test card. Bound at 18:57:00Z on
`payment_intent.succeeded`. Verified in the trial database, every line equal to the recited example:

| Entry | Cents |
|---|---|
| `premium_written` | 120 000 |
| `tax_and_fee_billed` | 5 320 (tax 2 820, fee 2 500) |
| `premium_collected` | 125 320 |
| `commission_earned` | 18 000 |

This step produced **F-B2-20** on his own screen: "last status: provider_accepted" on a bound
policy, because `checkout.session.completed` arrived after `payment_intent.succeeded` in the same
second. The ledger and the policy status were right; the display was not. Fixed at `0fa828d`.

## Endorsement above the customer threshold, 2026-09-09 06:28Z to 06:34Z, CGP-01707

Yoann as `broker@` requested the endorsement at 06:28:25Z (annual premium $1,200 to $2,400, limits
doubled, effective 2026-10-08), **approved it as `customer@` at 06:29:33Z**, then paid the delta as
`broker@` with the test card. `payment_intent.succeeded` at **06:34:34.327Z**, `endorsed` event at
06:34:34Z.

| Line | Formula in cents | Amount |
|---|---|---|
| Prorated premium, 335 of 365 days | floor(120000 x 335 / 365) = 110 136 | $1,101.36 |
| Tax on that premium | 2 588 | $25.88 |
| **Delta collected** | 112 724 | **$1,127.24** |
| Commission on the endorsement | 16 520 | $165.20 |

Four entries: `endorsement_premium_written` 110 136 and `endorsement_tax_billed` 2 588 effective
**2026-10-08** (business time); `endorsement_premium_collected` 112 724 and
`endorsement_commission_earned` 16 520 effective **2026-09-09** (the day the cash arrived). The
running side list adds up: collected 238 044, commission 34 520, unearned 230 136. Every figure
equalled the coordinator's hand calculation of the previous evening.

Two findings came out of this step: **F-YA-07** (the "Terms in force" panel showed the October terms
in September) and **F-B2-21** (the F-B2-20 guard covered issuance only, so the late
`checkout.session.completed` regressed the status on the delta collection too). Both fixed.

## LIVE-0, 2026-09-09 12:42Z to 12:43Z: two reconciliation runs and a statement re-run

Yoann ran "Reconcile both sources now" twice on production, at **12:42:38Z** and **12:43:00Z**:
Stripe 34 provider records against 7 ledger records, **7 matched** (the endorsement payment of
CGP-01707 now matched, which closed F-INT-06), 28 provider-only breaks, all of them probe payments
created in the shared Stripe sandbox by the day's check scripts (22 at the 06:00Z cron, 6 more at
12:42Z). Claim rail: 3 matched, no break.

He then used "Re-run with this knowledge cutoff" on the Redwood 2027-09 run page and got revision 5,
identical to revision 4, cutoff `2026-09-08T17:26:29Z` kept by design (rule 10). Three findings came
from his own comments on this session: **F-YA-10** (the board explains nothing about probes, which
became decision 28), **F-YA-11** (wording of the re-run affordance) and **F-YA-09** (no success
notice after the click). All three are closed.

## Checkpoint emails, sent by Yoann on the candidate thread

- **T+2h:** sent 2026-09-08 09:49 Europe/Zurich (07:49 UTC), one minute before the deadline.
  Draft: `docs/checkpoints/t-plus-2h-email.md`.
- **T+24h:** sent 2026-09-08 22:34 Europe/Zurich (20:34 UTC), nine hours and sixteen minutes before
  the deadline. Draft: `docs/checkpoints/t-plus-24h-email.md`.

The email header on the thread is the authoritative timestamp in both cases; the send times above
are as Yoann reported them.

## The evening of 2026-09-09: five more steps, driven by Yoann

Run with a co-pilot session (`corgi-work-trial-e1`, branch `live-fire-evidence`) that computed the
expected figures before each click and read the result by GET afterwards, and that never submitted a
form on production. Full record with a figure-by-figure comparison table per step:
`docs/handoffs/live-fire-day2.md`. **Every figure of every step agrees.**

**LIVE-0, 18:38:23Z and 18:45:13Z.** The reconciliation run: 42 provider records against 7 ledger
records, **32 probes and 4 breaks to act on**, matching the prediction exactly; the four survivors
are the $100.00, the two $12.61 and the -$8.98 refund. Then the Redwood September statement:
revision 4 superseding revision 3, format version 3 so the comparison reads "format changed", 16
lines, cash collected $8,328.61, commission $1,209.61, clawback $780.05, **net due $429.56** against
$389.35 at revision 3, the difference being +$345.20 of CGP-01707 commission and -$304.99 of
CGP-01274 clawback recorded after the revision-3 cutoff. Content hash
`7eddb01ae791314713dc57eb69a11d07bbafc1f4926028417391d6af0919c78c`, predicted and read identical.

**LIVE-8, 19:33:07Z: the backdated correction, which no one had performed until tonight.** The
CGP-01707 endorsement moved from 2026-10-08 to 2026-09-22: reversal entries at the original
effective date, a re-book at the corrected one, cash untouched, and **$53.84 to collect** (premium
$52.61 plus tax $1.23), commission $7.89. The customer approved it and the broker paid it; Stripe
delivered the event at **19:50:43Z** and the deployed application answered `status: done`, which is
visible from the provider's side in the live-integration pack.

**LIVE-9, 20:11:09Z: the second endorsement, and with it the as-of reading that was impossible.**
$2,400.00 to $2,700.00 effective 2026-10-01: 342 of 365 days, prorated premium
`floor(30000 x 342 / 365)` = 28109, tax 660, **delta $287.69**, commission $42.16. The cumulative
threshold worked as decision 24 says: running total $1,435.06, above $500, so the customer approved
first. The policy then carried two endorsements for the first time, and the three as-of readings
were taken: 2026-09-15, **2026-09-25 between the two**, and 2026-10-05.

**LIVE-7, to 20:34:32Z: cancelling CGP-01707 with an open claim.** Four refunds above the threshold
queued for approval, each shown to the initiator with the chip "not an approver" and no decision
form, then approved by a distinct human (`approver@`) at 20:34:28Z to 20:34:32Z, each with its
intent text and hash under "What was approved, exactly".

**LIVE-3, to 20:54:28Z: broker KYB, live on Stripe Connect.** One broker approved (Sierra Crest,
pending at 20:50:41, approved at 20:53:53, the two-minute settling window visible), one refused
(Harbor Point, `verification_failed_tax_id_match`), and binding refused until approved. Then, past
the brief: Yoann paid CGP-01709, $12,307.00, at 20:54:28Z. The record flags the consequences rather
than hiding them: Sierra Crest's September statement is no longer empty, and the next reconciliation
matches one more payment.

---

# 4. Gaps

Everything below is a gap in the **evidence**, not necessarily a defect in the code. Each line says
what is missing and where the fact comes from.

## 4.1 Orphans: none

Every one of the 263 files under `docs/evidence/` is reachable from a record. The breakdown:

- **53** are named individually, by path or by filename, in a record. That number rose from 31 when
  the cycle-2 record was corrected: it now names all 24 of its own files with their md5, which is
  the shape every evidence section should have.
- **121** are named individually in `docs/evidence/ui-audit-2026-09-09/observations.json`, the
  audit's own index, which `docs/ui-audit-2026-09-09.json` and `docs/STATUS.md` cite. Every index
  entry resolves to a file that exists, and every `.jpg` in that directory appears exactly once.
- **89** are covered by their directory's citation or by a count the record states, not by name.

**One soft gap inside that last group.** `docs/reviews/b13-13-ui-audit.md` describes its evidence as
"one PNG per issue under `docs/evidence/b13-13-ui-audit/`, named by issue id". Five of the 30 files
there are not named by an issue id (`375-journal-entry-clipped.png`, `375-policy-folds-open.png`,
`375-reconciliation.png`, `375-statements.png`, `regressions-inbox-ops.png`). They are the 375 px
and regression frames of sections 5 and 6 of that record, so they belong to it, but the sentence
that describes the directory does not cover them. A one-clause fix to that sentence closes it.

## 4.2 Dangling citations: none

All **93** distinct `docs/` paths cited by the records resolve to a file that exists. The one
dangling citation this pack found on its first pass, `docs/reviews/ui-cycle-2.md` (cited by
`docs/reviews/FINDINGS.md` rows F-BP-02 and F-BP-03 as "CONFIRMATION PENDING"), landed with the
merge of `92379e2` and is indexed in section 1.

## 4.3 Six evidence files did not show what they were named for: FOUND AND CLOSED (F-UI2-08)

**The hard finding of this pack, and it is closed.** Hashing every evidence file found one group
that should not have existed; the others are accounted for in 4.4. This one was a defect, and
correcting it turned up a further file nobody had asked about.

**What was wrong.** Five files under `docs/evidence/ui-cycle-2/` were byte-identical, md5
`c5789dd085614cec9ed051b17793d746`, 76 646 bytes each: `approvals.png`, `claim-payments.png`,
`endorse-preview.png`, `recon-ops-board.png` and `recon-runs.png`. The image was opened for this
pack: it was `/login`, the signed-out sign-in page, with empty email and password fields. Nothing
about an approval, a claim payment, an endorsement or a break appeared in any of them. Two of the
five, `recon-ops-board` and `recon-runs`, were the named illustration of the record's matrix item 2,
the breaks-board port.

`docs/reviews/ui-cycle-2.md` section 11 stated that the 24 files were "each opened and reviewed
before being committed". That sentence was false for those five, and its AF-05 line carried the same
defect.

**Cause,** as the reviewer's own correction records it: one capture script signed in once and then
took five shots in a loop **with no guard on the result**. The session was lost during the loop,
every navigation redirected to `/login`, and the script screenshotted the redirect five times
without noticing. The other nineteen files were genuine because every other script in the pass
either signed in immediately before its shot or asserted on the content.

**The fix, at `c8d679d`, merged `b33edbc`.** A new capture script refuses to write a file unless,
on the page itself: the final URL is not `/login`, the AF-02 mode line is present (it renders only
when signed in), and a set of strings specific to that screen is found. All five passed all three
guards. The reviewer then re-opened the other nineteen and **found a sixth file wrong in a different
way**: `reference-drawer.png` was signed in and genuine but showed the inspector *refusing* a
hand-typed reference shape, which is the opposite of what the record claims the drawer does. It was
recaptured by following a link the page itself renders. The record's section 12 states all of this
in its own words rather than quietly rewriting the original sentences.

**Verified independently for this pack, at `b33edbc`:**

- 24 files, **24 distinct md5 values**, 4.05 MB. The duplicate group is gone.
- The record's md5 table was compared to the files on disk: **24 rows, 24 files, zero mismatch**, no
  file on disk missing from the table and no table row missing from disk.
- Two of the recaptured images were opened rather than trusted. `approvals.png` is the Money-out
  approvals screen as `Sam Patel, operations`, signed in, with the mode line and the three tiles
  (Waiting 0, Amount waiting $0.00, Agent raised 1). `recon-ops-board.png` is the breaks board with
  the band reading `4 breaks to act on` and `32 probes from check runs`.

**One consequence the freeze package has to carry.** The six recaptured files illustrate `92379e2`,
not the reviewed `c408cb3`, because production moved between the review and the recapture. That is
stated per file in section 2 and in the record. It matters for the breaks board: at `92379e2` the
**Explained breaks table is empty** ("Nobody has written a note on a break yet"), because the break
that was explained, `pi_3UDQN7K6R3v50tIy0fdlIi1Q`, has been reclassified as a probe by a later run
and now sits in the probe table. Nothing is lost and the F-BP-02 closure is not affected: it was
measured at `c408cb3` and is preserved in `recon-explained.png`, which was opened for this pack and
is genuine. But anyone re-running matrix item 2 against today's production will find that table
empty and should expect to.

**The general lesson, and the reason line C2 exists in the freeze checklist.** A screenshot proves
nothing until somebody looks at it. A filename, a byte size and a sentence in a record are not
evidence, and a capture script without a guard will cheerfully photograph a login page five times.

*A note on the timestamp: the reviewer's correction section is stamped "20:55Z", which is the local
time, not UTC; the correction was made at 18:55Z. The coordinator has added a note to the record.*

## 4.4 Nine duplicate-content groups, all accounted for

Hashing the whole tree finds **nine** groups. Five are benign and two of those are themselves
evidence; the other four are files the live-integration pack copied on purpose and declares as
copies. None is a mistake.

| Files | Why they are identical |
|---|---|
| `b12-4/reduced-0140ms.png` and `reduced-1400ms.png` | This **is** F-B12-16: with `prefers-reduced-motion` the finished state appears at once, so 140 ms and 1400 ms must look the same |
| `b12-4/motion-1400ms.png` and `motion-2200ms.png` | The animation has finished by 1400 ms, so the later frame is the same frame. Confirms the 600 ms count-up completes well inside the window |
| `b12-4/hidden-1400ms.png`, same hash as the two above | Consistent with the handoff: in the hidden case "the reveal opened nothing, drew nothing and moved nothing", and in the plain motion series the connector is not drawn either, so both end on the same finished fold with no connector |
| `b12-4/reduced-0000ms-at-rest.png` and `visible-0000ms-at-rest.png` | At rest, before any reveal, the reduced and normal cases are the same page by design |
| `ui-audit/console-feed.jpg` and `console-navigation-after.jpg` | Captured 57 seconds apart. This **is** UI-025: the note on the second reads "No navigation click after Overview; page automatically returned to Console", so the after-shot being the console feed is the finding |
| `b13-13-ui-audit/regressions-inbox-ops.png` and `ui-016-inbox-first-viewport.png` | One capture filed under two names, serving the UI-016 item and the regression sweep. Harmless duplication, not a wrong image |

The four remaining groups are the live-integration pack's declared copies, each verified for this
pack to be byte-identical to the source its own manifest names:

| Copy | Source it declares |
|---|---|
| `live-integration-2026-09-09/03-Deployed-Application/01-kyb-approved-earlier-capture.jpg` | `ui-audit-2026-09-09/broker-kyb-approved.jpg` |
| `.../02-kyb-failed-earlier-capture.jpg` | `ui-audit-2026-09-09/broker-kyb-failed.jpg` |
| `.../03-correction-and-ledger-earlier-capture.png` | `live-fire-day2/LIVE-8/after/policy-money.png` |
| `.../04-reconciliation-earlier-capture.png` | `live-fire-day2/LIVE-0/after/reconciliation.png` |

Copying an image into a second folder is fine when the copy says where it came from. That is the
difference between these four and F-UI2-08: these declare their origin and match it byte for byte.

## 4.5 Records whose own standing verdict is FAIL

Eight records end on FAIL and carry no re-review section of their own. Five of them are superseded
rounds, which is how the adversarial rounds were designed to work; three need reading.

| Record | Standing verdict | Why it stands, and what closes it |
|---|---|---|
| `backend-mcp-tools-r1.md` | FAIL at `6a41c2a` | Superseded by r2 then **r3, PASS at `ce42a3c`** |
| `backend-mcp-tools-r2.md` | FAIL at `5976e4f` | Superseded by **r3, PASS at `ce42a3c`** |
| `backend-breaks-board-r1.md` | FAIL at `dee775b` | Superseded by r2 then **r3, PASS at `48d6e63`** |
| `backend-breaks-board-r2.md` | FAIL at `4cf3cc9` | Superseded by **r3, PASS at `48d6e63`** |
| `backend-inspect-reference-r1.md` | FAIL at `0b9202d` | Superseded by **r2, PASS at `9b9902a`** |
| `b13-13-ui-audit.md` | **FAIL for the cycle**, on F-UA-01 | F-UA-01 was closed by the LOW screens sweep at `3890300`, and `b13-14-low-screens.md` measures the two lists identical cell for cell at $1,253.20. **No re-review section was appended to `b13-13-ui-audit.md` itself**, so the record still reads FAIL |
| `b13-14-low-screens.md` | **FAIL for the cycle**, on F-LU-01 | F-LU-01 was closed by the interface rework (`docs/STATUS.md` at 15:20:00Z, "Closed by the rework: F-YA-05, F-YA-09, F-YA-11, F-LU-01 to F-LU-05"), verified by `ui-system.md` PASS at `2af6ebe`. **No re-review section was appended to this record either** |
| `backend-production-confirmation.md` | **FAIL at `100ef41`** on F-BP-01 | Expected and explained: the probe classification is stored **by a run**, and no reconciliation has run since the deploy. One "Reconcile both sources now" on production closes it. Done by Yoann at 18:38:23Z (LIVE-0), register CLOSED at 57a0051. That click is Yoann's (LIVE-0, `YOA-645`); **the daily cron of the 10th falls after the freeze**, so if the click is not made, the board freezes counting probes as breaks |

The two cycle FAILs are the honest kind of gap: the defect is fixed and independently measured, but
it is measured in a *different* record. A reader following `b13-13-ui-audit.md` alone would stop at
FAIL. Appending one paragraph to each, pointing at the record that closed it, would remove the
ambiguity; the coordinator owns that call.

## 4.6 AF-06 is not satisfied

**48 of the 50 review records end "Candidate walkthrough status: NOT REVIEWED WITH YOANN."** The two
that do not are `illustration-integration.md` (a Codex record, which states AF-06 human
understanding is NOT RUN) and `instructions-2026-09-08.md` (a review of the instruction files,
written before any product code existed).

`docs/reviews/integration.md` says it in the verdict itself: the integration verdict is PASS "with
AF-06 still NOT SATISFIED". `docs/COMPLIANCE-MATRIX.md` says it under Open items: "No engineering
PASS in this matrix substitutes for that."

Two live scenarios were driven by Yoann and both left **his own spoken explanation pending**:

- LF-4, cancellation with an open claim: STATUS records "Walkthrough status for this scenario: DONE
  BY YOANN; his explanation of why the reserve stays: pending."
- The endorsement: "Walkthrough status: DONE BY YOANN; his explanation of 'priced from the effective
  date' pending."

This is not something an agent can close. It closes when Yoann explains the money path back, in his
own words, on the three stories prepared for the debrief.

## 4.7 Live-fire items: the table after tonight

Five of the seven were driven by Yoann tonight, on branch `live-fire-evidence`, with the expected
figures computed before each click and the result read by GET after it
(`docs/handoffs/live-fire-day2.md`). **This table replaces the one in
`docs/COMPLIANCE-MATRIX.md` section 4**, which was written before tonight and now understates what
has been done; the matrix needs the same update before the email quotes it.

| Item | Status now | Evidence |
|---|---|---|
| LF-1 issue and pay with a test card | **Live by Yoann**, twice on 2026-09-08, and a third time tonight (CGP-01709, $12,307.00, 20:54:28Z) | `docs/STATUS.md`; `live-fire-day2/LIVE-3/after/` |
| LF-2 backdated fix on the deployed application | **Live by Yoann tonight**, 19:33:07Z. Was "NOT RUN: not done by anyone" this morning | `live-fire-day2/LIVE-8/`, and the provider side in `live-integration-2026-09-09/01-Stripe-Payments/06-...jpg` |
| LF-3 replay the payment webhook twice | **Check only**, unchanged: coordinator HTTP probes plus `check:payment-replay` 34/34. Not driven by Yoann | `docs/reviews/b2-issuance-and-collection.md` |
| LF-4 cancel with an open claim | **Live by Yoann**, twice: CGP-01274 on 2026-09-08, and CGP-01707 tonight with four refunds above the threshold through the approval queue | `docs/STATUS.md`; `live-fire-day2/LIVE-7/` |
| LF-5 the policy as it stood between two endorsements | **Live by Yoann tonight.** Was "NOT RUN, blocked on data": no policy carried two endorsements. LIVE-9 created the second, and the three as-of readings are 2026-09-15 ($1,200.00 / $28.20 / $1M / $2M), **2026-09-25, between the two ($2,400.00 / $56.40 / $2M / $4M)**, and 2026-10-05 ($2,700.00 / $63.45) | `live-fire-day2/LIVE-9/after/as-it-stood-on-*.txt` and `.png` |
| LF-6 detect a planted payout mismatch on the breaks screen | **Partial, unchanged in kind but better evidenced.** The 18:38:23Z run classified 32 probes and left four genuine provider-only breaks. Still true: `local_only`, `amount_mismatch` and `stale` have never been produced on production, and no human planted one and watched it appear | `live-fire-day2/LIVE-0/after/` |
| LF-7 the initiator refused on the approvals queue | **Observed live tonight**, one step short of driven: on the queue the four requests raised by the broker each carry the chip **"not an approver"** with no decision form, and a distinct human (`approver@`) then approved them at 20:34:28Z. The record is careful about who read what: "the waiting state itself is Yoann's read" | `live-fire-day2/LIVE-7/` |

**What is still not done, stated plainly.** LF-3 remains a check-script and HTTP-probe proof rather
than a rehearsal. LF-6 remains partial: a probe found on the board is not the same as a human
planting a mismatch and watching it surface, and three of the five classifications have never
appeared on production data.

## 4.8 Findings still open at `b33edbc`

The full register is `docs/reviews/FINDINGS.md`. The ones that matter for the freeze:

- **F-BP-01 (MED)**: **the evidence shows this closed, and the register caught up at 57a0051 and ad44d32: CLOSED by Yoann's LIVE-0 click at 18:38:23Z, figures in `docs/handoffs/live-fire-day2.md` (3c67d45).** Before
  that, its line read "EXPECTED, closes with one reconciliation run on production" and predicted the
  board would then read "0 to act on and the probes apart". The recaptured `recon-ops-board.png`, at
  `92379e2` and opened for this pack, shows a run has happened: the band reads **`4 breaks to act
  on`** and **`32 probes from check runs`**, the probe table holds 32 rows of $42.42, and the four
  breaks left are the $100.00, the two $12.61 and the -$8.98 that the backend review predicted would
  remain. The prediction of "0 to act on" was the only part that was wrong, and it was wrong in the
  safe direction: four genuine provider-only breaks survive and are still shown. Worth one register
  line and one STATUS line before the email quotes any of it.
- **F-BP-02 (MED)** and **F-BP-03 (LOW)**: **closed.** The breaks-board port is merged at `c408cb3`
  and on production, and `docs/reviews/ui-cycle-2.md` confirms it, PASS at `c408cb3`, with the
  explained break visible under its own heading with its note, its author and its time.
- **F-UI2-08 (evidence)**: the five wrong screenshots of section 4.3, recapture in progress.
- **F-INT-04 (MED)** and **F-INT-06 (LOW)**: one click each, assigned to Yoann. F-INT-06 was closed
  by LIVE-0; F-INT-04 (run September on `/ops/statements`) was still open when the matrix was written.
- **F-INSPECT-05 (LOW)**: a decision put to Yoann at 20:35 local, whether a broker key should get one
  sentence for both "not yours" and "matches nothing" so it cannot probe for existence.
- **F-B4-01 / decision 27**: parked money in `unapplied_customer_cash` has no refund path in this
  build. Disclosed in the README, on the ledger and in the week-two plan. Not a defect hidden, a
  feature not built.
- Roughly sixty LOW and INFO findings sit on the B13 backlog or are marked DISCLOSED or ACCEPTED
  with a reason in the register. None is HIGH and none is MEDIUM-unaddressed.

## 4.9 Two evidence facts worth recording

- **The two `inspect_reference` review records were untracked until `5cfbc26`.**
  `docs/reviews/backend-inspect-reference-r1.md` and `r2.md` existed on disk in the main checkout
  but were not in Git, so a clean clone at `a530b84` would have carried the eighth MCP tool with no
  independent review record behind it. Found while building this index and committed at `5cfbc26`.
  Worth a line in the freeze checklist: **the record set is only complete if `git status` is clean.**
- **Eighteen `.env.local` copies and four `.local/` directories live in worktrees.** They are
  gitignored, so there is no AF-05 commit exposure, and `gitleaks git` over the history is the
  control that proves it. They are still credential copies on disk and they leave with their
  worktrees at the freeze. `docs/handoffs/freeze-checklist.md` carries the commands.

---

# 5. External sandbox references

Every reference below is quoted from a record. **All of them are Stripe test mode**; the records
that name a `livemode` flag record it as `false`. None of them is a secret: `pi_`, `re_`, `cs_`,
`acct_`, `evt_` and `we_` are object identifiers, and `cmk_` values are the public key prefixes the
application prints on `/ops/mcp-keys`.

| Kind | Count | Where they are cited |
|---|---|---|
| `pi_` PaymentIntents | 23 | `b10-reconciliation.md` (10), `b2-issuance-and-collection.md`, `b5-cancellation-and-refund.md`, `b13-13-ui-audit.md`, `backend-production-confirmation.md`, the three breaks-board rounds (one probe each), `integration.md`, `recheck-day2.md`, `ui-system.md`, `docs/handoffs/b10-implementation-notes.md`, `docs/handoffs/b12-1-agent-demo.md`, `docs/STATUS.md` |
| `re_` Refunds | 3 | `re_3UDKq0K6R3v50tIy11aPmuHK` (the day-0 feasibility probe), `re_3UDM4KK6R3v50tIy0scSGaps` (created by the delegate's worktree server, which is why F-B5-04 stayed open), **`re_3UDN8aK6R3v50tIy0J6CmRy3`** (the live cancellation refund Yoann drove, $2,081.09) |
| `cs_` Checkout Sessions | 10 | `docs/STATUS.md` and the B2/B4/B5 records |
| `acct_` Connect accounts | 24 | `docs/handoffs/docs-kyb-implementation-notes.md` (20 probe accounts), `b3-broker-kyb.md`, `docs/handoffs/b3-implementation-notes.md`, `docs/STATUS.md`. The demo broker's account is `acct_1UDNobK6R3ohMVag`; the failed tax-id fixture is `acct_1UDNv2K6R3y2nGVW` |
| `evt_` webhook events | 20 | `b2-issuance-and-collection.md`, `b5-cancellation-and-refund.md`, `b3-broker-kyb.md`, `docs/STATUS.md`, `docs/COMPLIANCE-MATRIX.md` |
| `we_` webhook endpoints | 2 | `we_1UDKzYK6R3v50tIybe5BIytW` (the account endpoint) and `we_1UDOHHK6R3v50tIyfbZP2ohD` (the Connect endpoint, `connect=true`, same URL, its own signing secret) |
| `cmk_` MCP key prefixes | 12 | `b11-mcp.md` (6), `integration.md`, `post-pass-changes.md`, `recheck-day2.md`, `b13-2-low-batch.md`, `docs/handoffs/b11-*.md`, `docs/handoffs/b12-1-agent-demo.md`. The agent key of the MCP demonstration is `cmk_e96f88a4` |
| **Total real objects** | **93** | |

**Added by tonight's evidence**, and none of them appeared in any text record before: the CGP-01707
issuance pair `pi_3UDUCUK6R3v50tIy06eM9VlU` and `evt_3UDUCUK6R3v50tIy0MtOqkDo` (USD 1,253.20,
2026-09-08 18:57:00 UTC), the correction pair `pi_3UDrW1K6R3v50tIy1GPWqtve` and
`evt_3UDrW1K6R3v50tIy1YusKFe5` (USD 53.84, 2026-09-09 19:50:43 UTC), and the Harbor Point connected
account `acct_1UDOfRK6R3FpfF2D`. They come from the Stripe dashboard captures and from
`docs/evidence/live-integration-2026-09-09/evidence-manifest.json`, which is a reminder that the
provider side held references our own records had never written down.

Four tokens that look like references and are not: `cmk_deadbeef` and `cmk_xxxxxxxx` (placeholders
proving a wrong key is refused, and a redaction pattern), `re_check_now_at_stripe` (a prose token),
and `evt_replaytest_*` (the two synthetic replay-test events the README discloses as stored, marked
ignored and never posted).

Linear: 33 distinct ids, `YOA-593` to `YOA-656`. The project is
`linear.app/yoannjobs/project/corgi-trial-readiness-resilience-and-us-compliance-0f574499f657`.
`docs/STATUS.md` at 18:35:00Z records that no session on this machine has reached Linear since the
account change at 17:14 local, so the ticket state is not currently readable and the local records
are the working source, as `AGENTS.md` requires when Linear is unavailable.
