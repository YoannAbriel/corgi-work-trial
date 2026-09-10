# Submission publication and credential remediation review

Independent reviewer: `/root/publication_review`. Initial review: 2026-09-10T01:07:41Z.

## Scope and startup receipt

B14 evidence packaging and AF-05 remediation only, on main at `c22816d457dd980097db4fbfe1eeb65527ac706b`: `.gitignore`, new `.gitleaks.toml`, staged deletion of `docs/evidence/live-fire-day2/tools/cookies/ops@example.com`, and new `docs/evidence/live-integration-submission/`. No product code change reviewed. Coordinator owns deployment, shared records, publication and form filling; final submission is explicitly prohibited by the user.

Actual reads: AUTOMATIC-FAILS.md in full before review; AGENTS.md in full, WORKFLOW-48H.md, REVIEWER.md, READABLE-CODE.md, structured released brief docs/BRIEF-REFERENCE.md; README integration/operation/limitations sections; relevant STATUS incident/current entries, DECISIONS authorization/latest entries, PLAN B14, COMPLIANCE-MATRIX SEC-01/DEP-01; original Downloads REVIEW-NOTES.md; new evidence index/README; .gitignore diff, scanner configuration, pre-commit hook and lib/auth/session.ts. No mandatory file found absent. Separately supplied original kickoff sandbox rules remain unavailable as disclosed by BRIEF-REFERENCE. Local records used; Linear not queried. About 4 hours 42 minutes remained to freeze. Next criterion: publish an authentic screenshot pack without spreading a usable credential. Planned checks: image identity, redacted current/history scans and evidence of credential invalidation, including older deployments.

## Applicable sources and checks

Sources read September 10: AUTOMATIC-FAILS.md AF-05 (official trial ban plus user remediation safeguard), AF-01/02/04/06; docs/BRIEF-REFERENCE.md general submission evidence requirement; AGENTS.md Git hygiene and verification gates. This is security/evidence handling, not a new legal or provider-contract interpretation.

- Gitleaks 8.30.1 `git --log-opts=--all . --config=.gitleaks.toml --redact --no-banner`, JSON output inspected without values: **exit 1, exactly one finding**, rule `corgi-signed-session`, known cookie path at commit `24f4606a95bb4ed49454d6821b2565e977b20017`, line 1. No other scanner finding. This is a failing history scan, not a clean-history claim.
- Exported the actual Git index using `git checkout-index --all --prefix=<temporary-directory>/tree/`, then `gitleaks dir` with the same configuration/redaction: **exit 0, no leaks**, 31.57 MB scanned. This confirms the staged removal; ignored local credentials were not exported.
- `gitleaks dir docs/evidence/live-integration-submission --config=.gitleaks.toml --redact --no-banner`: **exit 0, zero findings**. Scans are textual, not OCR or a guarantee of absence.
- Python SHA-256 comparison: **all 14 image files match the earlier independently reviewed Downloads originals byte-for-byte**. Reused original reviewer visual inspection and its explicitly limited PASS; no new image generation/edit or unsupported pending-KYB claim. Historical pack text is distinguished by the new README from publication.
- Inspected scanner rule: defaults remain enabled; added UUID/expiry/HMAC session shape catches the actual historical incident. No allowlist added. Cookie directory ignored and cookie removed from index; original history retained.
- Inspected session code: cookie signature depends on SESSION_SECRET; new secret rejects old signatures. Runtime verification, all accessible deployments and fresh login are coordinator checks, initially pending here.

## Findings and requirement matrix

| Requirement | Evidence/control | Initial result |
|---|---|---|
| AF-05 never committed secrets | Actual history finding in 24f4606; incident disclosed | **FAIL historically; remediation cannot erase the violation** |
| Prevent further usable credential exposure | Rotation/redeploy authorized; session verification inspected | **BLOCKED pending runtime evidence** |
| F-PUB-01: older deployment exposure | Immutable deployment URLs may retain old environment secret; alias rotation alone proves only alias rejection | **BLOCKED**: demonstrate protection/inaccessibility or invalidation for accessible older deployments before public history hosting |
| Current proposed files exclude detected secrets | Index snapshot and new pack scans | PASS for scanned content |
| B14 genuine bounded evidence; AF-02/04 | 14/14 identity matches; original image review; explicit simulator/old-image/missing-pending limitations | PASS for packaging only |
| AF-01 deployed functioning app | Coordinator post-rotation external check pending | NOT RUN by reviewer |
| AF-03 ledger invariants | No money code or rows changed in scope | NOT RUN; existing evidence not reapproved |
| AF-06 candidate understanding | No new product code; no candidate walkthrough by this reviewer | NOT RUN |
| Public viewer access and no final submission | Coordinator UI verification pending | NOT RUN |

F-PUB-01 is material because a publicly reachable old build using the prior secret can accept the exposed cookie even if the production alias rejects it. Browser cookie domain restrictions do not prevent an explicit HTTP Cookie header. No old deployment was removed or changed by this reviewer.

**Initial verdict: BLOCKED for public propagation until deployment invalidation evidence is complete.** Local scanner hardening, removal and screenshot packaging meet their bounded checks. Historical AF-05 remains FAIL; no integrated trial PASS, disqualification waiver, exhaustive secret absence or human-understanding confirmation is issued. No product regression suite or new provider side effect was run by this reviewer. Append re-review evidence below rather than replacing this record.

## Re-review at 2026-09-10T01:09Z: production rotation and sampled prior deployment

Read coordinator sanitized `.local/session-rotation-checks.json`: health HTTP 200, database ok, deployed code revision `756db05d071d5aff32eaae47cc73a474eb60db02`; broker, staff operations and customer fresh login each HTTP 303 followed by its home HTTP 200. Coordinator identifies new ready deployment `dpl_5TicLqfqDqyZAiHVW2cdz4kUKZft`. No product code change accompanied secret rotation.

Independently sent the committed cookie (read from Git only in process memory, supplied to curl through stdin, never output) to `/ops`: current public alias `corgi-work-trial-iota.vercel.app` returns **307 /login**; previous production immutable hostname `corgi-work-trial-7r9fmrr6x-yoanns-projects-898d9dd2.vercel.app` returns **302 to Vercel protection**. Both curl commands exit 0 with normal TLS verification. A prior Python urllib attempt failed local certificate trust before receiving an HTTP response; it is not passing evidence. Cookie directory `git check-ignore` also succeeds.

Rotation on current public alias is independently verified, with fresh-role login evidence inspected. F-PUB-01 remains narrowly BLOCKED pending project-wide old-deployment protection or equivalent alias inventory evidence; one sampled old hostname does not enumerate all public old aliases. Historical AF-05 remains FAIL regardless of resolution.

## Final bounded re-review

Read `.local/deployment-protection-check.json`, coordinator's sanitized project API response: project `prj_csUTjDCrALki51oDW6tVObdziytb` has `ssoProtection.deploymentType = all_except_custom_domains`. Together with the independent previous-build 302 protection check and current public alias 307 rejection, this supplies the protection evidence requested by F-PUB-01. **F-PUB-01 closed for the known project deployment surfaces.** No unlisted custom domain is asserted to exist or to have been checked; do not disable old-deployment protection or restore an old build with the former secret.

Re-read updated evidence index: it now identifies repository publication and GitHub public read access; original capture facts and disclosed limits are retained. No image changed.

**PASS for the bounded remediation controls and proposed evidence publication, with historical AF-05 FAIL explicitly retained.** The exposed cookie is rejected by the public application, old immutable deployments have project protection, current indexed content and the screenshot pack have no scanner findings, and the custom rule correctly detects the historical incident. This permits the coordinator's authorized next publication step; it does not say publication has occurred, that the entire history is clean, that Corgi will waive the incident, or that B14/the integrated trial is complete. Coordinator must verify the eventual anonymous GitHub evidence URL and leave the portal unsubmitted. Fresh application login evidence covers broker, operations and customer; no new financial transaction or regression suite was needed for this configuration-only remediation.
