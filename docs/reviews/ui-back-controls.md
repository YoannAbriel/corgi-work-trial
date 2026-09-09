# Redundant policy back controls and aside wrapping

## Startup receipt and scope: 2026-09-08T21:04:18Z

Independent reviewer: `/root/ui_review`. Worktree `/Users/yoannabriel/dev/corgi-work-trial/.worktrees/corgi-interface`, branch `codex/corgi-interface`, initially clean at reviewed commit **cd6d5676a050638c961ad9043dd996486329e715**, compared with parent/main **957c88573598a93588fa21aeafc645a5cf347d71**. About 33 hours remain to the recorded freeze. This is a B13 cosmetic follow-up, not a new money-path or integrated delivery review.

Actual reads: AGENTS.md, AUTOMATIC-FAILS.md in full (all six bans), READABLE-CODE.md, WORKFLOW-48H.md, REVIEWER.md, README.md, released brief general/Track 1 sections; current STATUS entries, PLAN, COMPLIANCE-MATRIX, scope-relevant DECISIONS entries; UI-04 and UI/main-merge handoffs; existing UI-04 review and current UI/main-merge and UI-rebuild findings/verdicts. Mandatory files present. Read the complete four-file commit diff, affected page guards/forms and breadcrumbs, DetailLayout/AsideList and its policy/claim/statement consumers, relevant global/responsive CSS and SandboxReferences. Read the local bank-simulator source to establish real possible result text; did not execute it or any provider/database operation.

Next acceptance criterion: remove only redundant navigation while retaining usable parent navigation, unchanged form/access/calculation contracts and readable aside figures without overflowing long text. Planned checks: exact source comparison, focused typecheck, committed-range scan and narrow-layout source assessment. Existing web-interface-guidelines guidance remains applicable; no new legal/provider rule is introduced by these cosmetic edits.

## Finding

**F-BACK-01, MEDIUM: shared nowrap rule affects prose and identifiers, not only monetary values.** At `app/globals.css:1545`, all `.aside-list dd` now have `flex-shrink:0` and `white-space:nowrap`, replacing `overflow-wrap:anywhere`. `AsideList` also displays broker names (`app/policies/[policyId]/page.tsx:706`), bank account holder/result (`app/ops/claims/[claimId]/page.tsx:332`) and statement cutoff text. The bank's ordinary successful result is already a full sentence: `LOCAL SIMULATOR: the account at routing ...0000 is held by the claimant`. It cannot wrap or shrink inside the desktop 340px aside (48px panel horizontal padding, plus label and gap); the mobile single-column breakpoint does not restore wrapping. Longer valid names and failure reasons make this worse. The descendant selector also reaches `dd` inside expanded SandboxReferences.

Consequence: this CSS removes the previous narrow-layout protection from ordinary nonmonetary content, risking horizontal overflow or unreadable clipped panels while fixing short amounts. This is a concrete source-derived regression; browser pixel measurements have **not** been performed for this commit. Required correction: retain shrink/wrap behavior for general aside values and scope nonwrapping to explicitly marked monetary/short numeric values. Verify a monetary total, a long broker/holder name, a bank-result sentence and an expanded reference at narrow/mobile and desktop-aside widths. No financial formula should change.

No finding on the three removed navigation controls: each page retains a policy parent link in its breadcrumb trail, including direct-entry forms. The removed Link imports are unused after removing those anchors.

## Requirement and evidence matrix

| Requirement | Control/evidence | Result |
|---|---|---|
| B13 coherent parent navigation | Policy href retained in the cancel, endorse and new-claim trails; only redundant form-bottom anchors removed | PASS |
| Preserve form contracts and calculations | Independent script removes only the exact Link import and three-line anchor from each parent file, then checks complete byte equality with the reviewed file; all three match | PASS |
| Preserve authorization and business execution | Equality above includes every server guard/read/calculation and every method/action/field/required/min/max/default/hidden value; complete diff has no backend, API, configuration or dependency edit | PASS |
| Readable aside amounts and narrow layouts | Amounts stay together, but the same rule prevents prose/identity/reference wrapping; F-BACK-01 | FAIL |
| Technical/secret checks | `npm run typecheck`; `git diff 957c885 cd6d567 --check`; `gitleaks git --redact --no-banner --no-color --log-opts='957c88573598a93588fa21aeafc645a5cf347d71..cd6d5676a050638c961ad9043dd996486329e715'` | PASS; exit0 each, one commit scanned, no leaks |

## Automatic-fail mapping and limits

| Gate | Scoped result |
|---|---|
| AF-01 deployed accessible URL | NOT RUN for this commit; no deployment/authenticated browser check performed |
| AF-02 honest integration modes | PASS for unchanged source labels; no live-integration proof rerun |
| AF-03 immutable financial records | PASS for unchanged source scope; no SQL, money mutation or provider execution introduced; runtime guards NOT RUN |
| AF-04 sandbox only | PASS for review actions: read-only source and local typecheck/scan, no identities submitted, no provider call or spend |
| AF-05 no secrets | PASS for inspected exact committed increment and one-commit gitleaks range; earlier pre-commit scan not independently witnessed; rescan after staging this report, and full shared history before push/submission |
| AF-06 candidate ownership | Reading path is short and no new arithmetic is hidden; NOT REVIEWED WITH YOANN |

No build/unit/financial integration rerun: this tiny diff changes no executable business behavior and typecheck plus exact source comparison address contract preservation. No browser-render or full-WCAG claim. Existing unrelated LOW findings and integrated trial gates retain their own records.

**Verdict: FAIL for cd6d567**, limited to F-BACK-01. The redundant-back-control removal passes independently, but the combined cosmetic increment needs the narrower wrapping rule and an affected re-review before completion. No legal certification or integrated trial PASS.

## Re-review: 2026-09-08T21:06Z

Exact amended commit **586d5b968dfc7247c12ed95c45d287bd2821661b**, against the same parent **957c88573598a93588fa21aeafc645a5cf347d71**. Same continuing review session; mandatory reads remain as listed in the receipt. Read the complete new six-file diff, current status and changed component/CSS/call sites. Only this review record is untracked; no application changes by the reviewer.

**F-BACK-01 RESOLVED.** The original general `.aside-list dd` rule, including `overflow-wrap:anywhere`, is restored. Only an explicitly marked `dd.aside-value-nowrap` receives no-shrink/nowrap. `AsideList` exposes a small optional boolean and applies the class to that item's own value element. The only four enabled call sites are the existing formatted journal amounts on policy detail: collected, refunded, commission net and unearned premium. Broker/holder names, bank result sentences, timestamps, open-claim prose and nested reference values retain their parent revision's wrapping behavior.

Checks independently executed:

- Rendered the actual `AsideList` through React's static renderer with an explicitly nonwrapping `$1,234,567.89`, a long synthetic broker name, the actual simulator-result sentence and a nested reference `dd`. Exactly one element receives the nowrap class; name/prose/nested reference do not. PASS. This is DOM classification evidence, not browser pixel measurement.
- Repeated whole-file comparison for all three action pages after stripping only the removed Link import/anchor: PASS. The fourth policy page is byte-identical to the parent after stripping its four `nowrap:true` flags. Every submitted field/constraint/hidden value, access check, server read and calculation remains unchanged.
- `npm run typecheck`: PASS, exit0. `git diff 957c885 586d5b9 --check`: PASS. Repeated gitleaks committed-range scan for the exact amended commit: PASS, one commit / 763 bytes scanned, no leaks.

**Final verdict: PASS for this bounded cosmetic increment at 586d5b9.** No unresolved material finding in this diff. The earlier FAIL remains historical. Nonmonetary narrow-layout behavior is restored exactly to the reviewed parent; explicit amounts stay together. No new browser viewport sweep or assertion about arbitrarily large numeric strings is made. AF-01 and runtime integration checks remain NOT RUN; AF-02/03/04 retain the scoped source/action results above; AF-05 updated to the amended committed-range scan; AF-06 remains NOT REVIEWED WITH YOANN. The coordinator must scan this review after staging it. No B13-wide, deployment, full-WCAG or integrated-trial PASS follows from this result.
