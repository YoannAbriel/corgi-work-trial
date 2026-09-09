# Independent review, slice new-broker, round 3

Reviewer: independent confirmer sub-agent, working read-only in the builder's worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/wf_bd4e916d-509-1`, branch
`new-broker-route`. No branch was switched, no worktree was created, and the only file this
review writes is this record. Written at 2026-09-09T22:26Z (00:26 local).

Reviewed revision: **29981177bd3fa7da9f9da48146d58a500775dd09**, one commit above the revision
round 2 failed (`f6ba5cc`). The scope of this round is that one commit and nothing else:
`git show 2998117`, 5 files, +37, -9. `git diff 512c826..2998117` additionally contains the
round 2 record itself (`docs/reviews/backend-new-broker-r2.md`, committed as `3bd5a08`), which is
documentation and not under review here.

Rounds 1 and 2 are `docs/reviews/backend-new-broker-r1.md` (FAIL at `6aa11e4`) and
`docs/reviews/backend-new-broker-r2.md` (FAIL at `f6ba5cc`). Both are preserved unchanged; this
record appends round 3. Evidence from round 2 is reused only for scope this commit did not touch,
and each reuse says so.

This is a scoped engineering assessment of three findings. It is not a legal certification and it
is not a statement that the six delivery gates pass for the submission.

## 1. Startup receipt

Read in full before looking at the diff: `CLAUDE.md`, `AUTOMATIC-FAILS.md`, `REVIEWER.md`,
`docs/reviews/backend-new-broker-r2.md`.

Read in full for the scope: `git show 2998117` line by line, then each touched file end to end
rather than as hunks: `lib/auth/password.ts`, `lib/broker/reveal-cookie.ts`,
`lib/broker/reveal-cookie.test.ts`, `lib/broker/create-broker.ts`, and the changed parts plus the
hostile-address section of `scripts/check-new-broker.ts`. Read for the surrounding contract: the
`spendPasswordCheckTime` call site in `app/api/session/login/route.ts`.

Not read, and named as such: the released brief PDF (absent from this worktree), `AGENTS.md` and
`WORKFLOW-48H.md` (this round is a narrow confirmation of three findings against the round 2
record, which itself was written against them), `READINESS-CHECKLIST.md` and `STRESS-TEST-PLAN.md`
(this slice claims no performance profile), and the `docs/` records outside the review series,
because `docs/` belongs to the coordinator. This narrower reading is the timebox of a
three-finding confirmation and is disclosed rather than presented as a full feature review.

Absent files: none in scope.

## 2. Scope discipline: did anything outside the three findings change?

`git show --stat 2998117` is five files, and every hunk maps to one of the three findings:

| File | Hunk | Finding |
|---|---|---|
| `lib/broker/reveal-cookie.ts` | `isEmailSafeForRevealCookie` added, with its comment | F-NEWBROKER-06 |
| `lib/broker/create-broker.ts` | import and call swapped, refusal sentence rewritten | F-NEWBROKER-06 and 07 |
| `lib/broker/reveal-cookie.test.ts` | one new unit test, import widened | F-NEWBROKER-06 |
| `scripts/check-new-broker.ts` | `SEPARATOR_EMAIL` fixture, one new invalid-form row, two comments | F-NEWBROKER-06 |
| `lib/auth/password.ts` | memo type and body, comment | F-NEWBROKER-08 |

No migration, no route, no schema, no grant, no money table and no `UPDATE` or `DELETE` statement
is touched. `isCookieSafeValue` stays exported and stays tested; its only remaining production
caller is `isEmailSafeForRevealCookie`, which is the intended shape.

## 3. Attacks on `isEmailSafeForRevealCookie`, and what they returned

The check is `isCookieSafeValue(email) && !email.includes("|")`
(`lib/broker/reveal-cookie.ts:60`), called from `readNewBrokerForm`
(`lib/broker/create-broker.ts:66`) after the shape check and **before** anything is written:
`createBrokerWithSignIn` is a separate function, the route calls `readNewBrokerForm` first, and
the first `insert` of the slice is inside `sql.begin` in that second function. A refusal therefore
throws `BrokerCreationRefused` with no connection opened.

Probe run outside the repository, importing the two modules directly, one line per case
(`form` is what `readNewBrokerForm` did with the same address):

```
{"input":"\"a|b@example.invalid\"","emailSafe":false,"form":"refused: The contact email must be plain ASCII without a space, a semicolon, a comma, a quote, a backslash or a vertical bar"}
{"input":"\"a@b.co|\"","emailSafe":false,"form":"refused: ... or a vertical bar"}
{"input":"\"|a@b.co\"","emailSafe":false,"form":"refused: ... or a vertical bar"}
{"input":"\"a@b|c.co\"","emailSafe":false,"form":"refused: ... or a vertical bar"}
{"input":"\"A|B@Example.Invalid\"","emailSafe":false,"form":"refused: ... or a vertical bar"}
{"input":"\"a b@example.invalid\"","emailSafe":false,"form":"refused: The contact email must be an email address of at most 200 characters"}
{"input":"\"proébe@example.invalid\"","emailSafe":false,"form":"refused: ... or a vertical bar"}
{"input":"an address holding U+0001","emailSafe":false,"form":"refused: ... or a vertical bar"}
{"input":"an address holding U+007F","emailSafe":false,"form":"refused: ... or a vertical bar"}
{"input":"\"\"","emailSafe":true,"form":"refused: The contact email must be an email address of at most 200 characters"}
{"input":"\"a@b.co\"","emailSafe":true,"form":"ACCEPTED"}
{"input":"\"a'quote@b.co\"","emailSafe":true,"form":"ACCEPTED"}
```

Reading of each case:

- **A bar anywhere is refused**: local part, domain, first character, last character, and after the
  `toLowerCase()` that `readNewBrokerForm` applies first, so an uppercase input cannot smuggle one.
- **A space** never reaches the new check: `looksLikeAnEmailAddress` refuses whitespace one line
  earlier, with the address sentence. The bar case is the opposite, and this is the important one:
  `[^\s@]+@[^\s@]+\.[^\s@]+` accepts a bar, so the new check is genuinely the only gate on it.
- **A non-ASCII character** is refused, as before.
- **The empty address** returns `true` from `isEmailSafeForRevealCookie` on its own (the regular
  expression is anchored with `*`, so it matches the empty string). It is unreachable through the
  form, because the length check runs first, which the probe confirms. It is a trap for a future
  second caller and is recorded as an observation below, not as a finding.
- **The apostrophe is accepted**, which matters for the wording of the sentence: see section 5.

`readRevealCookieValue` still splits on the FIRST bar (`reveal-cookie.ts:69`). That is now sound
because both halves are bar-free, and I checked the second half rather than believing the comment:

```
alphabet holds a bar: false  size 56
characters ever produced outside the alphabet: []   (2000 generated passwords, 40000 characters)
round trip of an ordinary pair is whole: true
edge reads of "", "|x", "x|", "nobar": [null,null,null,null]
```

So a leading bar, a trailing bar and a bar-free value all read back as `null`, and the page says
the password is gone rather than printing half of it. The invariant the split depends on is
enforced on the email side by this commit and held on the password side by the alphabet.

## 4. The memoisation, read for a race and for a retry

```ts
let hashOfNoAccount: string | null = null;
if (hashOfNoAccount === null) {
  hashOfNoAccount = await hashPassword(randomBytes(32).toString("hex"));
}
await passwordHashMatches(submittedPassword, hashOfNoAccount);
```

- **Two concurrent callers cannot reach an inconsistent state.** Both may see `null` and both may
  derive; each then assigns a complete string, and JavaScript runs one thread, so no caller can
  read a half-written value. Whichever assignment lands last is a valid scrypt hash of a random
  password nobody holds, which is the only property the function needs: `passwordHashMatches`
  returns `false` and spends full scrypt time either way. There is no state in which a caller
  matches, and none in which a caller skips the work.
- **A rejection now retries.** The assignment happens only on success, so a `hashPassword` that
  rejects leaves the memo `null`, the exception propagates to that one request, and the next
  request derives again. The permanent 500 of F-NEWBROKER-08 is gone. The single failing request
  still becomes a 500 through `withActivity`, which is the same behaviour the previous code had
  for its first call and is the correct fail-loud answer for a broken crypto primitive.
- **What the change costs, measured, and why it is not a finding.** The promise memo shared one
  derivation between concurrent cold callers; the string memo does not, so N callers arriving
  before the first one finishes each derive their own throwaway hash. Measured in a fresh process,
  40 concurrent calls:

```
{"concurrency":40,"coldBurstMs":442,"warmBurstMs":221,"oneWarmCallMs":21}
```

  The cold burst is about double the warm one, so the cost is roughly one extra derivation per
  caller, once, in a window that ends with the first successful derivation. Every one of those
  calls already runs a scrypt compare, so the worst case is doubling a cost the route pays anyway,
  for a few hundred milliseconds after a restart. Round 2 measured that 40 concurrent logins move
  `/api/health` by nothing at all. Recorded as considered and rejected, so nobody re-derives it.

## 5. Does the refusal sentence describe what the code refuses?

The sentence is "The contact email must be plain ASCII without a space, a semicolon, a comma, a
quote, a backslash or a vertical bar".

**For every address an operator will realistically type, yes**, and it is a clear improvement on
round 2's sentence: the vertical bar is now named, the space is named, and "plain ASCII" is what
actually sends an accented address away. Two edges where the words and the code do not line up
exactly, both measured above:

1. **The apostrophe is accepted**, but "a quote" reads as covering it. Only the double quote is
   outside the cookie-octet set. An operator refused for a double quote is told the truth; an
   operator who reads the sentence and removes an apostrophe from an address that was already fine
   has been mildly misled.
2. **A control character and the delete character are refused**, and both are ASCII, so "plain
   ASCII" does not describe why. These cannot be typed into the form by hand and only arrive
   through a scripted post, so no operator meets this case.

Neither edge leaves an operator unable to act on a refusal, which was the harm F-NEWBROKER-07
named, so F-NEWBROKER-07 is answered. The two edges are recorded here rather than reopened.

## 6. What I ran, with the commands and the actual results

All commands were run from the builder's worktree, read-only, on the disposable `corgi_test`
database. No connection string and no secret value was printed by anything below, and the probes
live in the session scratchpad, outside the repository.

```
npm run typecheck
> tsc --noEmit
(no output, exit 0)
```

```
npm test
# tests 549
# suites 2
# pass 548
# fail 0
# cancelled 0
# skipped 1
# duration_ms 1612.185666
```
549 against round 2's 548: the one new test is
`an email carrying the separator is refused for the reveal cookie (F-NEWBROKER-06)`. The single
skip is `lib/kyb/stripe-connect.live.test.ts`, pre-existing and outside this slice.

```
npm run check:new-broker
45 PASS, 0 FAIL, 1 SKIP, exit 0, "all checks passed"
```
45 against round 2's 44: the new line is
`PASS  an email carrying the cookie separator is refused, naming the field  (The contact email
must be plain ASCII without a space, a semicolon, a comma, a quote, a backslash or a vertical
bar)`. The SKIP is the four screen assertions, at `1173 brokers in the disposable database, over
the 100 this check waits for` (F-NEWBROKER-05, unchanged, coordinator's). Disclosed: I ran this
script twice, because the first run's output was truncated by my own command before I could count
it; both runs passed and the second is the one counted here.

```
gitleaks detect --log-opts=512c826..2998117 --redact -v
3 commits scanned. no leaks found.
```

```
git status --short
(clean, before and after this record was written)
git show 2998117 | grep -c "em dash or en dash"
0
```

Not executed, and why: `scripts/check-money-guards.ts` (forbidden to this reviewer; this commit
grants no privilege and touches no money table); the built server and the reveal screen (round 2
proved the hostile-address behaviour over HTTP at `f6ba5cc`, and the only production change since
is one boolean tightening in the same function plus a sentence; `check:new-broker` runs the same
POST against a real server and reproduces the refusal, so a second 214-second page render would
buy no new fact); the deployed application (this branch is not deployed; AF-01 is the
coordinator's).

## 7. Findings

### F-NEWBROKER-09 (LOW) The check script's account-side line still counts two hostile addresses out of three, and its comment now says three

**Trigger.** `scripts/check-new-broker.ts:195`:
`const hostileAccounts = (await countUsersWithEmail(SEMICOLON_EMAIL)) + (await countUsersWithEmail(COMMA_EMAIL));`
`SEPARATOR_EMAIL` is not in that sum, and the reported line still reads "no sign-in account exists
for either hostile address". The comment above it was changed by this commit to "no sign-in
account was created for any of them", which claims a coverage the next line does not have. That
edit also left a dangling fragment: the comment now reads "for any of them / of them."

**Consequence.** The line round 2 called "the line that says the refusal happened before the
INSERT and not after it" does not say it for the address this whole round is about. The regression
would still be caught indirectly, by `no broker row was written by any invalid form`, because the
broker `insert` precedes the user `insert` inside the same transaction, so a separator address
that got through would leave a broker row behind. So this is an evidence gap and a false comment,
not an uncovered defect, which is why it is LOW and not MEDIUM.

**Required correction.** Add `SEPARATOR_EMAIL` to the sum, rename the reported line to "no sign-in
account exists for any hostile address", and repair the two-line comment.

### F-NEWBROKER-10 (LOW) The comment that caused F-NEWBROKER-06 is still there, and the required correction named it

**Trigger.** `lib/broker/reveal-cookie.ts:30`, unchanged by this commit: "A vertical bar cannot
appear in an email address and is not in the password alphabet, so the first bar is always the
separator." The first half is false about email addresses in general (RFC 5322 puts `|` in
`atext`, and round 2 measured a browser posting one), and it is exactly the belief that produced
F-NEWBROKER-06: a reader who trusts it writes no check. What is now true is narrower and belongs
in those words: *this build refuses* an address carrying a bar, in `isEmailSafeForRevealCookie`.
The required correction of F-NEWBROKER-06 asked for this line explicitly, alongside the code
change, and only the code change was made.

Second location, same defect: `reveal-cookie.ts:76` still credits `isCookieSafeValue` for a check
that `isEmailSafeForRevealCookie` now makes.

**Consequence.** Documentation only; the code is correct at this revision. It matters because the
comment invites the next reader to remove or bypass the check that the same commit added.

**Required correction.** Two comments, no behaviour change: state the invariant as something this
build enforces and point at the function that enforces it, and name the current caller at line 76.

### Observation, not a finding

`isEmailSafeForRevealCookie("")` returns `true`. Unreachable through the form, because the empty
address is refused one check earlier, and confirmed unreachable by probe. If a second caller ever
appears that does not run the shape check first, this returns "safe" for a value that is not an
address at all. Worth one guard clause if the function ever gains a second caller.

### Findings carried, unchanged and out of this round's scope

F-NEWBROKER-02 and F-NEWBROKER-05 stay OPEN for the coordinator, F-INSPECT05-01 stays OPEN for the
coordinator and Yoann, F-NEWBROKER-03's disclosed seeded-account exception is unchanged. Nothing
in this commit touches any of them.

## 8. Automatic-fail gate, for this scope only

| Rule | Verdict | Evidence |
|---|---|---|
| AF-01, accessible deployed URL | NOT RUN | This branch is not deployed. Out of scope of a feature review; the coordinator owns it |
| AF-02, no simulation presented as live | PASS | This commit calls no provider and claims no live integration. Unchanged from round 2 |
| AF-03, never UPDATE or DELETE a money row | PASS | Five files, no money table, no migration, no grant, and no `UPDATE` or `DELETE` statement anywhere in `git show 2998117`. The commit strictly reduces the number of unrepairable rows the slice can create |
| AF-04, sandbox only, no real data | PASS | `corgi_test` and `@example.invalid` fixtures throughout, the new `SEPARATOR_EMAIL` included. No provider call, no live key, no personal datum. My probes wrote nothing to any database |
| AF-05, never commit a secret | PASS | `gitleaks detect --log-opts=512c826..2998117 --redact`, 3 commits, no leaks found. The throwaway hash of `spendPasswordCheckTime` opens no account and is never written anywhere. No connection string was printed by any command in this review |
| AF-06, own and explain every line | BLOCKED, on Yoann's side | The three changes are explainable: one boolean AND with its reason beside it, one sentence, one `if` replacing a `??=`. Nothing here establishes that Yoann can defend them. Walkthrough status below |

## 9. Verdict

**PASS** at `29981177bd3fa7da9f9da48146d58a500775dd09`, with two LOW findings open.

The MEDIUM that failed round 2 is genuinely closed, and I attacked it rather than reading the
claim. A vertical bar is refused in the local part, in the domain, at either end and in upper
case, before any connection is opened, and the one-time password alphabet holds no bar over 40000
generated characters, so the first-bar split the reveal cookie depends on is now safe on both
sides. The refusal sentence names the rule an operator can act on, with two edges written down
above rather than smoothed over. The memo holds a string, a rejection retries, two concurrent
callers cannot reach an inconsistent state, and the one cost of the change is a bounded cold-start
burst I measured and am recording as rejected rather than as a finding. `npm run typecheck` clean,
`npm test` 549 tests, 548 pass, 0 fail, 1 skipped, `npm run check:new-broker` 45 PASS, 0 FAIL,
1 SKIP, exit 0.

The two findings are documentation and evidence, not behaviour: a check-script line that counts
two of three hostile addresses under a comment that now claims three, and the comment at
`reveal-cookie.ts:30` that still asserts the false invariant which caused F-NEWBROKER-06 in the
first place and whose correction was part of that finding's required action. Neither is a
violation of a requirement in scope, and REVIEWER.md does not make cosmetic items blocking, so
they do not hold the verdict; they should be closed before the slice merges, because the second
one is an invitation to delete the check.

Residual limitations, all visible above: the console's Rule column still under-reports for these
two routes (F-NEWBROKER-02, coordinator); the four screen assertions of `check:new-broker` remain
skipped on `corgi_test` and are carried from round 2 for this revision (F-NEWBROKER-05,
coordinator); a seeded account with no hash still answers a wrong password faster than an account
with one, disclosed in the code (F-NEWBROKER-03); this round did not re-run the built server, and
says so in section 6.

Walkthrough status: **NOT REVIEWED WITH YOANN**. The question this round adds is one sentence:
why refusing the vertical bar is a decision about the cookie format and not about email addresses.

## 10. Register lines

For the coordinator to paste into `docs/reviews/FINDINGS.md`; this review does not edit that file.

## new-broker round 3 (docs/reviews/backend-new-broker-r3.md, PASS at 2998117, 00:26 local; typecheck clean, 549 tests 548 pass 1 skipped, check:new-broker 45 PASS 0 FAIL 1 SKIP, bar refused in every position by probe, password alphabet bar-free over 40000 characters)

| ID | Severity | Finding | Required action | Status |
|---|---|---|---|---|
| F-NEWBROKER-06 | MEDIUM | The earlier fix refused the five characters a cookie value may not hold but not the vertical bar, the separator of that same value | `isEmailSafeForRevealCookie` refuses it before any INSERT; proved in every position, in both halves of the address and after the lower-casing, plus one unit test and one check-script fixture | FIXED 2998117 |
| F-NEWBROKER-07 | LOW | The refusal sentence named four characters while the check refused many more | Sentence now names the whole rule; two edges recorded in round 3 section 5 (the apostrophe is allowed, control characters are ASCII yet refused), neither leaves an operator unable to act | FIXED 2998117 |
| F-NEWBROKER-08 | LOW | `hashOfNoAccount` memoised the promise, so one scrypt failure would answer 500 for the life of the process | The memo holds the string and is assigned only on success: a rejection retries, and two concurrent callers cannot reach an inconsistent state. Cold-start cost measured, 442 ms against 221 ms for 40 concurrent calls, bounded and one-off | FIXED 2998117 |
| F-NEWBROKER-09 | LOW | `check-new-broker.ts:195` sums the accounts of the semicolon and comma addresses only, while the comment this commit rewrote claims all three and leaves a dangling "of them"; the separator address is covered only indirectly, by the broker-row line | Add `SEPARATOR_EMAIL` to the sum, rename the reported line to "any hostile address", repair the comment | OPEN (builder) |
| F-NEWBROKER-10 | LOW | `lib/broker/reveal-cookie.ts:30` still asserts "A vertical bar cannot appear in an email address", the false invariant that caused F-NEWBROKER-06 and whose correction was part of that finding's required action; line 76 still credits `isCookieSafeValue` for a check `isEmailSafeForRevealCookie` now makes | Rewrite both comments to say what this build enforces and where; no behaviour change | OPEN (builder) |
