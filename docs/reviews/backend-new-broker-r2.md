# Independent review, slice new-broker, round 2

Reviewer: independent reviewer sub-agent, working in the builder's worktree
`/Users/yoannabriel/dev/corgi-work-trial/.claude/worktrees/wf_bd4e916d-509-1`, branch
`new-broker-route`. No branch was switched and no second worktree was created. Written at
2026-09-09T22:14Z (00:14 local).

Reviewed revision: **f6ba5cc8086f1227acb47d0b693f380a35a6451b**, one commit above the revision
round 1 failed (`6aa11e4`) and five above `main` (`40352c8`). The whole slice diff is
`git diff 40352c8...HEAD`: 17 files, +1742, -17. The fix under review is
`git diff 512c826 f6ba5cc`: 8 files, +158, -11. Working tree clean at checkout and clean after
this record was written; every probe this review ran lives in the session scratchpad, outside
the repository, and none was committed.

Round 1 is `docs/reviews/backend-new-broker-r1.md`, verdict FAIL at `6aa11e4` on F-NEWBROKER-01.
That record is preserved unchanged; this one appends round 2 rather than rewriting it. Prior
evidence is reused only for scope the fix did not touch, and each reuse says so.

This is a scoped engineering assessment of one slice. It is not a legal certification and it is
not a statement that the six delivery gates pass for the submission.

## 1. Startup receipt

Read in full, in this order, before looking at any code: `CLAUDE.md`, `AUTOMATIC-FAILS.md`,
`AGENTS.md`, `REVIEWER.md`, `READABLE-CODE.md`.

Read in full for the scope: `git diff 512c826 f6ba5cc` line by line, then each touched file end to
end rather than as hunks: `lib/broker/reveal-cookie.ts`, `lib/broker/reveal-cookie.test.ts`,
`lib/broker/create-broker.ts`, `lib/auth/password.ts`, `app/api/session/login/route.ts`,
`app/api/brokers/route.ts`, `app/ops/brokers/reveal/consume/route.ts`, and the changed parts of
`scripts/check-new-broker.ts`. Read for the surrounding contract:
`app/ops/brokers/page.tsx` and `components/ui/reveal-done.tsx` (what the operator is actually
shown), `lib/observability/log.ts` (`withActivity`, `classify`, what a throw becomes),
`docs/reviews/backend-new-broker-r1.md` in full, `docs/reviews/FINDINGS.md` (register format).

Not read, and named as such: the released brief PDF (absent from this worktree; the requirements
used here are those of `AGENTS.md` and of the decisions the code cites), `READINESS-CHECKLIST.md`
and `STRESS-TEST-PLAN.md` (this slice claims no performance profile), and the `docs/` records
outside the two named, because `docs/` belongs to the coordinator.

Absent files: none in scope.

Acceptance criterion in scope, unchanged from round 1: a staff operations user creates a broker
and its sign-in account from `/ops/brokers?view=new`, in one transaction, and is shown once a
one-time password that is stored only as a hash and never travels in a URL, a log, an activity row
or a page that survives the reveal; every other role and no session are refused; the seeded
accounts sign in exactly as before. Round 2 adds: the five findings of round 1 are answered, and
the answers hold under attack.

## 2. Applicability

Unchanged from round 1 and re-checked at this revision. No provider call, no network destination,
no money arithmetic and no money row. The only tables written are `brokers` and `users`. No
`UPDATE` and no `DELETE` statement exists anywhere in the slice diff. Every address used by the
check script and by my probes is `@example.invalid`, on the disposable `corgi_test` database.

The fix adds no table, no column and no grant: migration `0027_users_password_hash.sql` is
untouched by `512c826..f6ba5cc`.

## 3. What each round 1 finding got, and whether it holds

| Finding | Round 1 severity | What the builder did | What I measured at f6ba5cc | Verdict |
|---|---|---|---|---|
| F-NEWBROKER-01 | MEDIUM | Refuses the address instead of encoding the value: `isCookieSafeValue` in `lib/broker/reveal-cookie.ts:49`, called from `readNewBrokerForm` before any INSERT | Live on the built server, five hostile addresses: semicolon, comma, double quote, backslash and a non-ASCII letter all answer 303 to the form with the refusal sentence, set NO reveal cookie and create 0 sign-in accounts | RESOLVED for the five characters it names, **but the separator character itself is still accepted**: see F-NEWBROKER-06 |
| F-NEWBROKER-02 | LOW | Not changed. The deviation is written beside both route descriptors, with the consequence and who closes it | `activity_log` on the disposable database: every own-gate refusal of both routes carries `rule = none`, exactly as the comments now say; the shared sign-in gate still carries `rule = "sign in"`, so the comments are accurate about what is and is not lost | OPEN, correctly recorded, for the coordinator |
| F-NEWBROKER-03 | LOW | `spendPasswordCheckTime` in `lib/auth/password.ts:88`, called on the "no user, or an agent principal" branch of the login route | 9 wrong-password attempts each on the built server, medians: absent address 499 ms, account carrying a scrypt hash 496 ms (round 1 measured 466 against 502). A seeded account with no hash still answers in 456 ms, which the code says out loud | RESOLVED for the accounts the finding was about; the seeded exception is disclosed in the code |
| F-NEWBROKER-04 | LOW | The `database: postgres.Sql = sql` parameter and the `postgres` type import are gone; `createBrokerWithSignIn` uses `sql.begin` directly | `npm run typecheck` clean; the rollback is proved over HTTP by `check:new-broker`: the duplicate email is refused and leaves `0 brokers named "... second try"` while the first broker is still there once | RESOLVED |
| F-NEWBROKER-05 | LOW | Not changed. The comment beside the skip states the count, whose evidence covers the four assertions, that it covers one revision only, and why counting this run's brokers would not help | The SKIP still fires: `1166 brokers in the disposable database, over the 100 this check waits for`. I re-ran the screen myself at this revision (section 4) rather than carrying round 1 forward | OPEN, correctly recorded, for the coordinator |
| F-INSPECT05-01 | LOW | Untouched, and rightly: nothing about it is on this branch | Confirmed: the 17 files of the slice diff contain no MCP file | OPEN, unchanged, for the coordinator and Yoann |

## 4. What I ran, with the commands and the actual results

All commands were run from the builder's worktree. `.env.local` is a symlink to the main
checkout's file, loaded with `process.loadEnvFile`; no value from it was printed by anything I
ran, and no connection string appears anywhere below. `scripts/check-money-guards.ts` was never
run, by instruction.

```
npm run typecheck
> tsc --noEmit
(no output, exit 0)
```

```
npm test
# tests 548
# pass 547
# fail 0
# skipped 1
```
The one skip is `lib/kyb/stripe-connect.live.test.ts`, pre-existing and outside this slice. The
builder's counts reproduce exactly, and the five tests of `lib/broker/reveal-cookie.test.ts` are
in the run.

```
npm run check:new-broker
44 PASS, 0 FAIL, 1 SKIP, exit 0, "all checks passed"
```
Every line reproduces the builder's report, including the two new refusals and
`no sign-in account exists for either hostile address (0 accounts)`. The SKIP is
`the screen checks (1166 brokers in the disposable database, over the 100 this check waits for)`.

**The built server.** `npm run build` (success), then `next start` with `NODE_ENV=production`
pointed at the disposable database, on ports 3813, 3814 and 3815 so as not to collide with any
other agent. This is the half the check script cannot cover, because it starts `next dev`.

Hostile addresses, one POST each with a staff operations session:

```
{"case":"semicolon","status":303,"refusalSentence":"The contact email must not contain a semicolon, a comma, a quote or a backslash","revealCookieSet":false,"setCookieCount":0,"signInAccountsCreated":0}
{"case":"comma","status":303,...,"revealCookieSet":false,"setCookieCount":0,"signInAccountsCreated":0}
{"case":"double quote","status":303,...,"revealCookieSet":false,"setCookieCount":0,"signInAccountsCreated":0}
{"case":"backslash","status":303,...,"revealCookieSet":false,"setCookieCount":0,"signInAccountsCreated":0}
{"case":"non ascii","status":303,...,"revealCookieSet":false,"setCookieCount":0,"signInAccountsCreated":0}
{"case":"vertical bar","status":303,"refusalSentence":"","revealCookieSet":true,"setCookieCount":1,"signInAccountsCreated":1}
{"case":"vertical bar","cookieValueTheBrowserKeeps":"a|b-30c8a9ed@example.invalid|eZNhjxWJZZXuncYd2ak7","emailTheScreenWouldShow":"a","passwordTheScreenWouldShow":"b-30c8a9ed@example.invalid|eZNhjxWJZZXuncYd2ak7"}
```

The ordinary path, and the cookie flags the check script cannot see:

```
{"case":"ordinary address","status":303,"location":"/ops/brokers?view=new&created=62c78804-...","cookieAttributes":"Path=/ops/brokers; HttpOnly; SameSite=Strict; Max-Age=120; Secure","passwordLength":20,"passwordIsInTheLocation":false}
```

**What the operator actually sees**, one page load of `/ops/brokers?view=new&created=<id>` on the
built server, with the session cookie and the reveal cookie, after creating a broker whose address
carries a vertical bar (`screen|probe-c43fb274@example.invalid`):

```
{"renderedInSeconds":214,"bytes":2207598,
 "showsTheSignInBlock":true,
 "showsTheAddressThatWasTyped":false,
 "showsTheTruncatedAddressInstead":true,
 "showsTheRealPasswordOnItsOwn":false,
 "showsTheMangledPasswordInstead":true,
 "saysThePasswordIsGone":false,
 "listsTheNewBrokerAsNeverSubmitted":true,
 "noRoutePendingNote":true}
```

That single load does two jobs. It is the evidence for F-NEWBROKER-06 below, and it re-proves at
this revision three of the four assertions `check:new-broker` skips: the block renders, the new
broker is listed, and the "Route pending" note is gone. The 214 seconds are the pre-existing N+1
read of `/ops/brokers` against a database holding 1166 brokers; not a defect of this diff.

**Login timing**, 9 wrong-password attempts each, medians on the built server:

```
{"absentAddress":499,"accountWithAScryptHash":496,"seededAccountWithNoHash":456}
```

**The activity log**, grouped over the whole disposable database:

```
/api/brokers                    ok       rule=none   message=null                                     17
/api/brokers                    refused  rule=none   "Only operations staff can create a broker"      18
/api/brokers                    refused  rule=none   "That email already has an account"               9
/api/brokers                    refused  rule=none   "The broker name must be 1 to 120 characters"    18
/api/brokers                    refused  rule=none   "The commission rate must be ..."                36
/api/brokers                    refused  rule=none   "The contact email must be an email address ..." 18
/api/brokers                    refused  rule=none   "The contact email must not contain a ..."       15
/api/brokers                    refused  rule="sign in"  "Please sign in again"                        9
/ops/brokers/reveal/consume     ok       rule=none                                                    19
/ops/brokers/reveal/consume     refused  rule=none                                                     9
/ops/brokers/reveal/consume     refused  rule="sign in"                                                9
{"activityRowsHoldingSomethingShapedLikeAOneTimePassword":0}
```

No row anywhere in `activity_log` matches a twenty-character run of the one-time password
alphabet. The `rule = none` picture is exactly the one the two route comments now describe.

**An attack that failed, reported because it failed.** Hashing on the anonymous branch means an
unauthenticated caller can now make the server spend scrypt time for free, which the previous code
did not. I measured whether that starves the rest of the process: the median of `/api/health`,
quiet, against the same median while 40 concurrent logins are in flight, once on an account with
no hash (no scrypt) and once on addresses that do not exist (scrypt):

```
{"quiet":349,"during40LoginsOnAnExistingAccountWithNoHash":345,"during40LoginsOnAddressesThatDoNotExist":348,"afterwards":343}
```

No measurable effect. The hypothesis is refuted, and there is no finding. An earlier, sloppier
measurement of mine showed 3003 ms and was a cold route, not contention; I am recording that so
nobody re-derives the wrong conclusion from it.

**Secrets.**

```
gitleaks detect --log-opts=40352c8..HEAD --redact -v
6 commits scanned. no leaks found.
```

**Dashes.** `git diff 40352c8...HEAD` piped through a grep for the em dash and the en dash returns
nothing; so does the same grep over this record and over round 1.

**What I left in the disposable database, disclosed.** Two broker rows and two sign-in accounts
whose addresses carry a vertical bar, created on purpose by the probes of F-NEWBROKER-06, plus
three seeded-style staff accounts and one ordinary probe broker. Nothing was deleted or updated to
make anything pass; `brokers` is append-only and the runtime role holds no UPDATE grant on either
table, which is exactly why those two accounts can never be repaired.

Not executed, and why: `scripts/check-money-guards.ts` (forbidden to this reviewer; the
coordinator proves the guards on an ephemeral database, and this fix grants no privilege);
the fourth screen assertion of round 1, the one that reads the page WITHOUT the cookie
(`app/ops/brokers/page.tsx` and `lib/broker/reveal-cookie.ts` `readRevealCookieValue` are
unchanged by this fix in that path, and each page load costs 214 seconds, so round 1's evidence is
reused for it and named here); the deployed application (this branch is not deployed; AF-01 is the
coordinator's); the other check scripts (untouched by this diff, and running them on the shared
database costs contention for no new evidence).

## 5. Findings

### F-NEWBROKER-06 (MEDIUM) The fix refuses five characters and leaves the sixth: the separator itself

**Trigger.** `POST /api/brokers`, from the ordinary HTML form, with a contact address whose local
part contains a vertical bar, for instance `a|b@example.invalid`.

**Why nothing stops it.** `looksLikeAnEmailAddress` forbids only whitespace and a second `@`
(`lib/broker/create-broker.ts:87`). `isCookieSafeValue` implements RFC 6265's cookie-octet set,
which **contains** `|` (0x7C falls in the `]-~` range of
`CHARACTERS_A_COOKIE_VALUE_MAY_HOLD`, `lib/broker/reveal-cookie.ts:49`). So both checks pass. But
`|` is not merely a character in the value: `revealCookieValue` uses it as the separator between
the two halves, and `readRevealCookieValue` splits on the FIRST one it finds
(`reveal-cookie.ts:59`). The comment at `reveal-cookie.ts:30` states the invariant that makes that
safe, "A vertical bar cannot appear in an email address", and the code above it does not enforce
that invariant. RFC 5322 puts `|` in `atext`, and the HTML valid-email-address production that
`type="email"` is checked against allows it in the local part, so the browser does not stop it
either. `AGENTS.md` forbids the browser being the control in any case.

**Consequence, measured on the built server and not argued.** The account is created (`303`,
`signInAccountsCreated: 1`), the reveal cookie is set, and the screen the operator reads shows the
email as `screen` and the "One-time password" as `probe-c43fb274@example.invalid|<the real
password>`. The operator copies that string; it does not open the account. This is the same harm
round 1 measured for the semicolon and gave MEDIUM to: a broker row and a `users` row that exist,
whose one-time password never reached anyone, in two tables the runtime role may only INSERT into,
so there is no repair path and the only answer is to create another broker. It is one notch softer
than the semicolon case only because the real password is the tail of the mangled string, which
nothing on the screen tells the operator.

**Required correction.** One line, either way: refuse the vertical bar with the other five in
`readNewBrokerForm` (and name it in the sentence), or make `readRevealCookieValue` split on
`lastIndexOf("|")`, which is safe because the password alphabet holds no bar. Whichever is chosen,
correct the comment at `reveal-cookie.ts:30`, which currently asserts something the code does not
enforce, and add the case to the invalid-form table of `scripts/check-new-broker.ts` beside the
semicolon and the comma, and to `lib/broker/reveal-cookie.test.ts`, whose test named "the five
characters a cookie value may not hold" is exactly the list that misses this one.

### F-NEWBROKER-07 (LOW) The refusal sentence names four characters, and the check refuses many more

**Trigger.** `POST /api/brokers` with an address carrying any character outside RFC 6265's
cookie-octet set that is not one of the four the sentence names: every non-ASCII letter, and the
delete character.

**Consequence, measured.** `proébe-<run>@example.invalid` is refused with
"The contact email must not contain a semicolon, a comma, a quote or a backslash". An operator
whose broker's address carries an accent reads a sentence that does not describe their address and
cannot act on it. Refusing internationalised addresses may well be the right call for this build;
saying the wrong reason is not. `READABLE-CODE.md` asks failure paths to be visible, and
`AGENTS.md` asks the sanitised sentence to be the thing the operator reads.

**Required correction.** Name the actual rule in the sentence, for instance "The contact email may
only contain ordinary printable ASCII characters, and not a semicolon, a comma, a quote or a
backslash". No behaviour change.

### F-NEWBROKER-08 (LOW) A single scrypt failure would freeze the login route's miss branch on 500 for good

**Trigger.** `lib/auth/password.ts:89`, `hashOfNoAccount ??= hashPassword(...)`. The memo holds the
PROMISE. If that first derivation ever rejects (scrypt raising on memory pressure is the realistic
case), the rejected promise is cached for the life of the process.

**Consequence.** Every later login on an address that does not exist awaits that rejected promise,
throws out of `handlePost`, and `withActivity` re-throws after recording it, which
`lib/observability/log.ts:265` turns into `outcome = error, statusCode 500`. The login form would
then answer 500 for every unknown address and 303 for every known one, until someone restarts the
server: a louder account oracle than the 36 ms of timing this function exists to close. I did not
manage to make scrypt fail, so this is read from the code and not measured, and its likelihood is
low.

**Required correction.** Cheap and local: clear the memo on failure, for instance derive into a
local variable inside a `try` and assign `hashOfNoAccount` only on success, or catch around the
`await` in `spendPasswordCheckTime` so a derivation failure costs the caller its time and nothing
else.

### Findings carried over from round 1, unchanged

F-NEWBROKER-02 and F-NEWBROKER-05 remain OPEN for the coordinator, now with the deviation written
in the code where a reader meets it, which is what round 1 asked for as the second option.
F-INSPECT05-01 remains OPEN and out of scope of this branch: it needs Yoann's word on which of the
two recorded wordings he decided, and `docs/DECISIONS.md` and `docs/reviews/FINDINGS.md` are the
coordinator's files.

## 6. Automatic-fail gate, for this scope only

| Rule | Verdict | Evidence |
|---|---|---|
| AF-01, accessible deployed URL | NOT RUN | This branch is not deployed. Out of scope of a feature review; the coordinator owns it |
| AF-02, no simulation presented as live | PASS | The slice calls no provider and claims no live integration. The README line the slice adds is true: a created broker signs in with its one-time password, the seeded users keep the demo password |
| AF-03, never UPDATE or DELETE a money row | PASS | No money table is touched, and no UPDATE or DELETE statement exists in the slice diff. Migration 0027 is unchanged by this fix and grants INSERT only. The unrepairable rows of F-NEWBROKER-06 are a consequence OF the append-only rule, not a breach of it, and I created two of them rather than repairing anything |
| AF-04, sandbox only, no real data | PASS | `corgi_test` and `@example.invalid` fixtures throughout, mine included. No provider call, no live key, no personal datum |
| AF-05, never commit a secret | PASS | `gitleaks detect --log-opts=40352c8..HEAD --redact`, 6 commits, no leaks found. The one-time password is generated per request and written to no file. No connection string was printed by any command in this review, and the probes that hold one live outside the repository |
| AF-06, own and explain every line | BLOCKED, on Yoann's side | The fix is explainable: `isCookieSafeValue` is one named regular expression with the reason beside it, `spendPasswordCheckTime` is three lines and says what it does not hide. Nothing here establishes that Yoann can defend it. Walkthrough status below |

## 7. Verdict

**FAIL** at `f6ba5cc8086f1227acb47d0b693f380a35a6451b`, on F-NEWBROKER-06 alone.

Four of the five round 1 findings are genuinely answered, and I re-measured each rather than
reading the claim. The five characters that break a `Set-Cookie` header are refused before any
INSERT, on the server, with a sentence the operator reads, and no account is created for any of
them. The login timing gap the finding named is closed, 499 against 496 where round 1 measured 466
against 502, and the one case it does not hide is written into the code in plain words. The unused
handle parameter is gone and the rollback is still proved over HTTP. The two findings left open
are recorded where a reader meets them, with the consequence stated exactly and the owner named,
which is what round 1 offered as the alternative to changing them.

The failing item is the character the fix's own separator is made of. `isCookieSafeValue` answers
the question "may a cookie value hold this?" correctly, and that is not quite the question this
value needs answered, because one character of the set is load-bearing for the format. The
consequence is the one round 1 called MEDIUM: an account that exists and whose one-time password
never reaches anybody, in tables that cannot be repaired. I created two such accounts in the
disposable database to prove it, and rendered the screen the operator would read. The correction
is one line, plus a comment that currently states a false invariant, plus the test and the check
line that would have caught it.

Residual limitations, all visible above: the console's Rule column still under-reports for these
two routes (F-NEWBROKER-02, coordinator); the four screen assertions of `check:new-broker` are
still unreachable on `corgi_test` and three of them are covered for this revision by my own page
load, the fourth by round 1's (F-NEWBROKER-05, coordinator); a seeded account with no hash still
answers a wrong password faster than an account with one, disclosed in the code (F-NEWBROKER-03);
the 214-second render of `/ops/brokers` on a database holding 1166 brokers is pre-existing and
outside this slice.

Walkthrough status: **NOT REVIEWED WITH YOANN**. The question this round adds to round 1's two is
short and the code answers it in one line: why the reveal cookie needs the address to be checked
at all, and what the vertical bar does to it.

## 8. Register lines

For the coordinator to paste into `docs/reviews/FINDINGS.md`; this review does not edit that file.

## new-broker round 2 (docs/reviews/backend-new-broker-r2.md, FAIL at f6ba5cc, 00:14 local; typecheck clean, 548 tests 547 pass 1 skipped, check:new-broker 44 PASS 0 FAIL 1 SKIP, hostile addresses and cookie flags proven on the built server)

| ID | Severity | Finding | Required action | Status |
|---|---|---|---|---|
| F-NEWBROKER-01 | MEDIUM | The reveal cookie value was unescaped, so a semicolon or a comma in the contact address broke `Set-Cookie` | Refused before any INSERT by `isCookieSafeValue`; five hostile addresses answer with the refusal sentence and create 0 accounts on the built server | FIXED f6ba5cc |
| F-NEWBROKER-03 | LOW | Login answer time separated an account carrying a scrypt hash from an address that does not exist | `spendPasswordCheckTime` on the miss branch; measured 499 against 496 where round 1 measured 466 against 502 | FIXED f6ba5cc |
| F-NEWBROKER-04 | LOW | `createBrokerWithSignIn` took a `database` handle no caller passed | Parameter and type import removed; rollback still proved over HTTP by check:new-broker | FIXED f6ba5cc |
| F-NEWBROKER-06 | MEDIUM | The fix refuses the five characters a cookie value may not hold but not the vertical bar, which is the separator of that same value: `a\|b@example.invalid` creates the broker and its account, and the screen shows the email as `a` and the password as `b@example.invalid\|<password>`, so the one-time password never reaches the operator and the two rows cannot be repaired | Refuse the vertical bar in `readNewBrokerForm` and name it in the sentence, or split on `lastIndexOf("\|")` in `readRevealCookieValue`; correct the false invariant comment at `lib/broker/reveal-cookie.ts:30`; add the case to `check:new-broker` and to `reveal-cookie.test.ts` | OPEN (builder) |
| F-NEWBROKER-07 | LOW | The refusal sentence names a semicolon, a comma, a quote and a backslash, but the check also refuses every non-ASCII character, so an accented address is refused with a reason that does not describe it | Name the actual rule in the sentence; no behaviour change | OPEN (builder) |
| F-NEWBROKER-08 | LOW | `hashOfNoAccount` memoises the promise, so one scrypt failure would make every login on an unknown address answer 500 for the life of the process, a louder oracle than the timing it closes; read from the code, not measured | Assign the memo only on success, or catch around the await in `spendPasswordCheckTime` | OPEN (backlog) |
| F-NEWBROKER-02 | LOW | Neither new handler names an `ActivityRule`, so the console Rule column reads "none" on their own gate refusals; confirmed in `activity_log` at this revision | Deviation now recorded beside both descriptors as round 1 allowed; the coordinator adds "broker creation" to the closed union after the merge | OPEN (coordinator) |
| F-NEWBROKER-05 | LOW | `check:new-broker` still skips its four screen assertions (1166 brokers on `corgi_test`, ceiling 100) | Deviation now recorded beside the skip; three of the four re-proved live at this revision by the reviewer, the fourth carried from round 1 | OPEN (coordinator) |
| F-INSPECT05-01 | LOW | Out of scope of this branch and untouched by it: the shortened sentence matches decision 53 but the register recorded the recommendation as one sentence for both cases | Confirm with Yoann which wording he decided; do not close F-INSPECT-05 on the enumeration ground | OPEN (coordinator) |
