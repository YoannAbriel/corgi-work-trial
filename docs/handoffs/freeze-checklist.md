# Freeze checklist

Run this in order at the freeze, before the final email is written. Every line has the command to
run and the result to expect. A line that does not produce its expected result is a blocker: fix it
or write it down in the email, never both skip it and stay silent.

Two rules that hold throughout:

- **Never open `.env.local`, `.env.vercel.local` or anything under `.local/`.** The commands below
  count and delete those files; none of them prints a value. If you need a secret at the freeze, read
  it from the deployment secret store, not from a file in the repository tree.
- **Run everything from the main checkout** (`/Users/yoannabriel/dev/corgi-work-trial`) unless a line
  says otherwise. Worktrees are removed by section A4, so a command run inside one stops working
  halfway through.

Timings measured on this machine on 2026-09-09: the history scan takes about 1.6 s, the whole of
section A about a minute, section B as long as the deployment takes to answer.

---

## A. The repository is what will be judged

### A1. The working tree is clean, and every record is actually committed

```bash
git status --porcelain
```

**Expect: no output.** Anything listed is either uncommitted work or an untracked file. This matters
more than it looks: on 2026-09-09 two independent review records
(`docs/reviews/backend-inspect-reference-r1.md` and `r2.md`) sat on disk untracked while the code
they reviewed was already merged, so a clean clone would have carried the eighth MCP tool with no
review record behind it. `git status` is the only thing that catches that.

If anything is listed, decide per file: commit it, or delete it. Do not leave it.

### A2. `main` is exactly what is on the remote

```bash
git fetch origin
git rev-parse main origin/main
```

**Expect: the same 40-character SHA printed twice.** Two different SHAs means the freeze SHA you are
about to quote in the email is not the one a reviewer will clone. Push, then re-run.

Record the short SHA now; it goes into the email as `[SHA]` and it must match section B1:

```bash
git rev-parse --short main
```

### A3. No secret anywhere in the history being shared (AF-05)

```bash
gitleaks git . --redact --no-banner --no-color
```

**Expect: `no leaks found`,** with the commit count printed. On 2026-09-09 at 20:58Z: `601 commits
scanned`, `13.40 MB`, `no leaks found`, 1.6 s. The commit count should be at or above that; if it is
lower, you are scanning the wrong thing.

This scans the **history**, which is what a reviewer receives. The pre-commit hook
(`.githooks/pre-commit`, `gitleaks protect --staged`) only ever saw one commit at a time, so it is
not a substitute for this line.

Then the working tree, which the history scan does not cover:

```bash
gitleaks dir . --redact --no-banner --no-color
```

**Expect: hits only in ignored or untracked locations** (`.next/`, `node_modules/`, the two `.env`
files, worktrees). Zero in tracked files. On 2026-09-09 a directory scan found 81 hits, all in
ignored or untracked locations, zero tracked. If section A4 has already run, this number drops
sharply because the worktrees are gone.

### A4. Every agent worktree is removed, with its credential copies

There are **64 worktrees** and **20 `.env*` copies** and **3 `.local/` directories** outside the main
checkout as of 2026-09-09 20:58Z. They are gitignored, so there is no AF-05 commit exposure, and A3
proves that. They are still credential copies on a disk, and they leave with their worktrees.

**Do this only when every other session has finished.** A live session loses its working directory
under it otherwise. At the time of writing, the freeze-package worktree, the live-fire one, and the
interface session's `ui-fixes` and `ui-breaks` are in use.

Count first, so you know what you are about to remove:

```bash
git worktree list | wc -l
find .claude/worktrees .worktrees -name '.env*' -not -name '.env.example' | wc -l
find .claude/worktrees .worktrees -type d -name '.local' | wc -l
```

Then remove the worktrees, which takes their copies with them:

```bash
git worktree list --porcelain | awk '/^worktree /{print $2}' | tail -n +2 | \
  while read -r w; do git worktree remove --force "$w"; done
git worktree prune
```

`tail -n +2` drops the first entry, which `git worktree list` always prints for the main checkout,
so the main checkout survives whichever directory you run this from. Do not filter on `$(pwd)`
instead: run from inside a worktree, that keeps the worktree and tries to remove the main checkout.

Confirm:

```bash
git worktree list
find .claude/worktrees .worktrees -name '.env*' -not -name '.env.example' 2>/dev/null | wc -l
find .claude/worktrees .worktrees -type d -name '.local' 2>/dev/null | wc -l
```

**Expect: one worktree (the main checkout), then `0`, then `0`.** The main checkout's own
`.env.local`, `.env.vercel.local` and `.local/` stay: they are how the machine runs and they are
ignored by Git.

Removing a worktree makes its agent unresumable. That is the intended end state at the freeze, and
it is the reason this line is late in the list rather than early.

### A5. Nothing was committed to `main` by mistake from a branch

```bash
git log --oneline --first-parent origin/main -12
```

**Expect: merge commits and coordinator docs commits only.** Every slice arrived through a
`--no-ff` merge. A stray direct commit is not fatal, but you should know it is there before a
reviewer reads the history.

---

## B. The deployment is what the repository says

### B1. `/api/health` reports the frozen SHA and reaches the database (AF-01)

```bash
curl -s https://corgi-work-trial-iota.vercel.app/api/health
```

**Expect:** `{"ok":true,"database":"ok","databaseTime":"...","revision":"<40-char SHA>"}`.

**The `revision` must equal the SHA from A2.** If it does not, Vercel did not build the frozen
commit. This has happened twice in this project: a push whose first-parent diff was documentation
only was skipped, and once GitHub simply did not trigger a deployment (`docs/STATUS.md`,
2026-09-09T18:35:00Z). The fix both times was one commit carrying a real code diff. Push it, wait,
re-run this line, and then update the SHA in the email, because the SHA that matters is the one
`/api/health` reports.

Run this from a network that is not your development machine's if you can. AF-01 is about a reviewer
reaching it, not about it answering locally.

### B2. The demo logins answer, for at least two roles

The seed creates six users: `ops@example.com`, `approver@example.com`, `broker@example.com`,
`broker2@example.com`, `broker3@example.com`, `customer@example.com`, all on the same demo password.
`customer2@example.com` was attached by hand on the deployed database.

Sign in **in a browser, in a private window**, as `ops@example.com` and as `broker@example.com` at
minimum, and check that each lands on its own home. Do not script this with the password on a
command line: it would put the secret in your shell history.

**Expect:** each sign-in lands on the role's workspace, the top bar carries the integration mode
line, and the sandbox sentence is on `/` and `/login`.

An anonymous check that needs no password, confirming the refusal path still fires:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://corgi-work-trial-iota.vercel.app/ops
```

**Expect: `307` to `/login`.**

### B3. The scheduled job is declared and its time is known

```bash
cat vercel.json
```

**Expect:** one cron, `"path": "/api/jobs/daily"`, `"schedule": "0 6 * * *"`, which is **06:00 UTC**,
08:00 Europe/Zurich.

**Know what this means for the freeze:** the next cron run is 06:00 UTC on September 10, which is
**ten minutes after the 05:50 UTC deadline**. Anything you were counting on the cron to do will not
happen before the freeze. In particular the probe classification on the reconciliation board is
stored **by a run** (F-BP-01), so if no reconciliation has run since the last deploy, the board
freezes counting probes as breaks. See D1.

### B4. The integration inventory still matches reality (AF-02)

Read the inventory table in `README.md` and confirm on the deployed screens that:

- every screen carries the mode line,
- every simulated row says `LOCAL SIMULATOR`,
- nothing labelled `LIVE SANDBOX` is in fact a simulator.

**Expect:** two slots `LIVE SANDBOX` (premium collection, broker KYB), two `LOCAL SIMULATOR` (bank
verification, claim payout rail), one `REAL` (document generation). If the live-fire session changed
any of that tonight, the README changes with it, not after.

---

## C. The package is complete

### C1. The evidence pack indexes what is actually there

```bash
find docs/evidence -type f | wc -l
```

**Expect: the number `docs/EVIDENCE-PACK.md` states in its Counts table.** It was 263 at `49ec797`.
If files were added since (the live-fire session writes `docs/evidence/live-fire-day2/`), the pack
needs one more section before the email quotes it.

### C2. No evidence file is a copy of another under a different name

```bash
find docs/evidence -type f -exec md5 -r {} \; | awk '{print $1}' | sort | uniq -d
```

**Expect: at most the six known duplicate groups** listed in `docs/EVIDENCE-PACK.md` section 4.4,
five of which are expected and two of which are themselves evidence.

**Any group not on that list must be opened and looked at before the freeze.** This line exists
because five files under `docs/evidence/ui-cycle-2/` turned out to be byte-identical copies of the
signed-out sign-in page while carrying the names of five different screens (F-UI2-08). A filename,
a byte size and a sentence in a record are not evidence. **Open the image.**

### C3. The four items of the email exist and resolve

- The **URL** answers (B1) and the **credentials** work for at least two roles (B2).
- The **repository link** opens for `@AlexanderReinicke` and `@mojafa`, once those invitations are
  authorized. Check it, do not assume it.
- The **video** is uploaded, the link plays for someone who is not signed in as you, and it is
  **five minutes or less**. Script: `~/Downloads/corgi-video-script.md`.
- The **evidence pack** is committed and on `origin/main`: `git log origin/main --oneline -1 -- docs/EVIDENCE-PACK.md`.

### C4. The repository carries what `WORKFLOW-48H.md` says it carries

```bash
ls docs/DECISIONS.md scripts/seed.ts .env.example docs/ATTACK-PLAN.md docs/EVIDENCE-PACK.md
```

**Expect: all five paths listed, no error.** The cut list is the section in `ATTACK-PLAN.md`; the
week-two plan is `~/Downloads/corgi-week-two-plan-DRAFT.md` and needs to be **copied into the
repository** before the freeze if the email is going to say the repository contains it. Decide which:
either move it in, or drop the claim from the email.

### C5. The three drafts that speak in Yoann's name have been read by Yoann

- `docs/checkpoints/t-plus-48h-email.md`, header "DRAFT, not sent, Yoann validates and sends"
- `~/Downloads/corgi-video-script.md`
- `~/Downloads/corgi-week-two-plan-DRAFT.md`

**Expect: Yoann has read all three and said so.** No agent sends the email, uploads the video or
speaks for him. The two placeholders in the email, `[SHA]` and `[VIDEO_URL]`, are filled by hand at
this point, and the demo password is pasted into the email and **never** into the file.

---

## D. What only Yoann can do, and what happens if he does not

### D1. One reconciliation run on production, before the freeze

On `/ops/reconciliation`, "Reconcile both sources now", once.

**Expect afterwards:** the board reads "N probes, M breaks to act on" with the probes counted apart,
rather than counting the probes as breaks. This closes **F-BP-01**, which is the one FAIL still
standing in `docs/reviews/backend-production-confirmation.md`.

**If he does not click it,** the board freezes in its current state and the pack says so. The daily
cron cannot save this: it runs at 06:00 UTC on September 10, ten minutes after the deadline (B3).

### D2. One statement run for September, if he wants F-INT-04 closed

On `/ops/statements`, "Run a statement", month `2026-09`, empty cutoff. Appends a run, moves no money.

### D3. The walkthroughs (AF-06)

**48 of the 50 review records end "NOT REVIEWED WITH YOANN."** No command closes this and no agent
can close it. Two live scenarios he drove himself both left his own explanation pending: why the
reserve survives a cancellation, and why an endorsement is priced from its effective date.

The three stories are prepared in `~/Downloads/corgi-revision-trois-histoires.md` and the agent
investigation in `~/Downloads/corgi-revision-enquete-agent.md`. Rehearsing them is the last thing on
this list and the only one that cannot be verified by a script.

---

## The one-line summary to paste into `docs/STATUS.md` at the end

> Freeze at `<SHA>`: working tree clean, `main` equals `origin/main`, gitleaks over `<N>` commits
> found no leaks, `<N>` worktrees removed with `0` credential copies left outside the main checkout,
> `/api/health` reports `<SHA>` with the database reachable, `<N>` evidence files indexed by
> `docs/EVIDENCE-PACK.md`, and the following remained open: `<list>`.

Fill every angle bracket with a measured value. An unmeasured line in that sentence is worse than no
sentence at all.
