# Corgi · Policy administration

Issue, collect, endorse, correct, cancel, handle claims and reconcile. Track 1 work trial. Next.js, Postgres (Neon), Vercel. **Sandbox data and money only.**

**[Open app](https://corgi-work-trial-iota.vercel.app) · [Video](https://youtu.be/zWF8vi1d2f4) · [Integration evidence](docs/evidence/live-integration-submission/)**

Demo: `broker@example.com`, `ops@example.com`, `approver@example.com`, `customer@example.com`. Shared password supplied privately in the submission portal.

## Integrations

| Slot | Provider / mode | Scope and limits |
|---|---|---|
| Premiums | Stripe · **LIVE SANDBOX** | Checkout, refunds, signed webhooks. Cards only; fees excluded. |
| Broker KYB | Stripe Connect · **LIVE SANDBOX** | Pending, approved, failed; binding gate. Same provider as payments, not a dedicated KYB bureau. |
| Bank verification | **LOCAL SIMULATOR** | Verified/failed fixtures; no Plaid connection. |
| Claim payouts | **LOCAL SIMULATOR** | Delayed settlement and returns; no external payout rail. |
| Documents | React PDF · **REAL** | Historical declarations and endorsement PDFs. |

[Dashboard captures and webhook logs](docs/evidence/live-integration-submission/00-START-HERE.md) distinguish live evidence from simulation and disclose missing captures.

## Run locally

Requires Node 20.19+, npm, Postgres, a Stripe sandbox and gitleaks.

```bash
git clone https://github.com/YoannAbriel/corgi-work-trial.git
cd corgi-work-trial
npm install
cp .env.example .env.local
# Fill the documented environment variables; sandbox credentials only.
git config core.hooksPath .githooks
npm run migrate
npm run set-runtime-role-password
# Set DATABASE_URL_APP to the app_runtime connection string.
npm run seed # Fresh database only.
npm run dev
```

[Environment placeholders](.env.example) · [Webhook setup and all checks](docs/IMPLEMENTATION-GUIDE.md#run-it-from-a-clean-clone). Health: `/api/health`.

```bash
npm run typecheck
npm run build
npm test
```

## Money and operations

- Owned, append-only double-entry ledger; USD integer cents. Daily pro-rata; charges round down, refunds up.
- Corrections reverse and re-book. Effective time and recorded time remain separate; published statement revisions are preserved.
- Money-out above $1,000 requires a distinct human checker. Agent requests always queue for approval.
- MCP: `/api/mcp`, six read tools, reconciliation and one approval-queued payment request. [Setup and never-delegated operations](docs/IMPLEMENTATION-GUIDE.md#mcp-surface).
- Reconcile from **Operations → Reconciliation → Run now**. Breaks stay visible; explaining a break does not repair money.

## Limits and review

Demo role switching weakens human separation. Stripe fees and suspense refunds are not implemented. Historical test artifacts and an early refund without approval are [disclosed](docs/IMPLEMENTATION-GUIDE.md#corrections-and-history).

A committed session credential was invalidated after detection. **The historical AF-05 failure remains disclosed:** [incident and remediation review](docs/reviews/submission-publication.md).

[Decisions](docs/DECISIONS.md) · [Checks, evidence and open gaps](docs/STATUS.md) · [Requirement coverage](docs/PLAN.md) · [Reviews](docs/reviews/) · [Cut list and week two](docs/WEEK-TWO-PLAN.md) · [Full implementation guide](docs/IMPLEMENTATION-GUIDE.md)
