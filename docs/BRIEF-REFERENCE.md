# Released brief reference

Source: general brief and all three track pages pasted by Yoann on September 8, 2026. This is a structured extraction, not an independently retrieved original. **Current selection: Track 1 — Policy administration, explicitly selected by Yoann on September 8, 2026.** The other tracks remain reference material; earlier recommendations are historical proposals. Sandbox rules from kickoff have not been supplied here.

## General requirements

One continuous 48-hour build. Kickoff reported as September 8 at 07:50 Europe/Zurich. T+2h attack plan: one page, three end-to-end use cases, provider picks, cut list v0. T+24h: deployed URL where money moves on a live sandbox rail. T+48h freeze; later commits ignored. Checkpoint email timestamps count. Within two working days: 75-minute live-fire debrief, ten-minute candidate demo, then replay, corrections, reversals and provider failure. Briefs intentionally incomplete and oversized; scope judgment is graded.

Ten non-negotiables:
1. Deployed accessible URL and demo credentials for at least two roles.
2. Own double-entry, append-only immutable ledger. Every external money event journaled; every displayed balance derivable, including as of past dates.
3. At least two genuinely live third-party sandbox integration slots, real API calls and real webhooks received by the deployed system. Track-specific requirements can require more.
4. Verified webhook signatures, idempotency, out-of-order tolerance. Polling is fallback, not the design.
5. Track-specific backdated correction: reversal entries plus re-book, never edits; corrected statement reconciles.
6. Money-out above a threshold requires maker-checker. Initiator cannot approve their own action; neither can an agent.
7. Reconciliation job pulls provider truth by API/file and diffs it against the ledger; a screen shows breaks. They plant a break.
8. Working MCP surface: at least three read tools and one write tool that enters human approval. Written list of operations never delegated autonomously, with reasons.
9. Money never float: integer minor units or exact decimals, stated rounding rule and deterministic pro-rata penny allocation.
10. Running timestamped decision log, including assumptions and cuts. An hour-47 retrospective does not satisfy this.

Automatic fails, as supplied:
- Localhost only, or a video in place of a URL.
- A simulated integration presented as live.
- UPDATE or DELETE on money rows. Anywhere. Ever.
- Live-mode API keys, real money, or real personal data.
- Secrets committed to the repo.
- Code you cannot explain line by line when we point at it.

Rules: USD cents only, US rails and conventions, no multicurrency. Buy/integrate provider capabilities; write your own ledger. Spend $0, test identities only, testnet only for stablecoins. A provider asking for a card or unavailable business verification is an access risk: use supported test entities or label simulation honestly, without claiming that a mandatory live slot passed. Any stack and AI allowed; candidate owns every line. Honor the clock and commit timestamps. Work stays candidate's.

Scoring: domain command 30, running system 25, integration reality 20, live fire 15, judgment/communication 10. The three screens that matter need default, loading, empty, error and one edge state. Unexpected useful work earns credit once the core stands; stretch is not an excuse to miss required mechanics.

Submission repo includes timestamped decision log, seed-from-zero script, .env.example, cut list and week-two plan. Also: deployed URL/two roles, repo access for AlexanderReinicke and mojafa, at-most-five-minute video, genuine live integration evidence (read-only dashboard access or screenshots including webhook delivery log). Final email on candidate thread to engineering-trial@corgi.com, subject Work trial: name, track number, with exactly four items: URL and role credentials; repo link; video link; evidence pack. Questions and checkpoints use the same thread. Drafting does not authorize sending or inviting people.

## Track 1: Policy administration

Core: issue policy, collect real test premium, endorse with pro-rated charge, cancel with actual provider refund, open/reserve/pay claim, produce broker statement tied to ledger. Portals, renewals, public API and extra scope are scoping calls.

Live required: premium collection (Stripe or GoCardless; actual refund API), broker KYB (pending and failed as well as approved; gate binding). Bank account ownership verification (Plaid auth + identity) and delayed/returnable claim payout rail may be live or simulated. Declarations and endorsement PDFs must actually be generated from data and support historical dates.

Domain: written versus daily earned premium and unearned liability; annual calendar term, leap years rather than fixed 365; endorsement premium delta from effective date, not entry date; wrong effective date three weeks ago corrected with reversal/re-book, old rows untouched and month reconciled; choose pro-rata or short-rate cancellation and support representation of the other; reserve adjustments append-only, payments reduce reserve, incurred = paid + reserve, cannot pay past limit; broker rate and defended written-versus-collected commission basis, clawbacks on refunds; monthly collected premium/commission/clawback/net-due statement tied to cents, closed-month rerun identical forever; historical coverage/limits/premium/documents; deterministic rounding penny; at least one US state's effective-dated premium taxes and fees properly separated from premium, earned premium and cancellation refundability.

Live fire: issue and pay with card/webhook journal; backdate correction; replay payment; cancel with open claim and explain refund/commission/reserve; as-of between endorsements; detect planted payout mismatch.

Suggested order: ledger/issuance first, live payment before lunch day one, endorsement maths next, portals/polish day two. Stretch: USDC claim payout, installments and failed third installment, e-sign, second line, broker API controls, reinsurance note. Hardest: correction honesty, endorsement maths, actual refunds and commission clawbacks.

## Track 2: Investment app

Core: real KYC, linked-bank deposit, model portfolio with real paper orders, daily valuation, late custodian correction restating return, daily reconciliation. USD/US securities, US market hours, T+1 settlement, US tax lots.

THREE live slots required: brokerage/custody (accounts/order lifecycle incl. partial fills, fill webhooks rather than polling alone); KYC pending/rejected/approved before funding; open-banking funding with linked bank deposits and bounced deposit. Market data live or simulated; custodian positions/cash/transactions file simulation expected, including late dividend and corrected price. A bank-link/auth call alone is not proof of funding. Idle cash/USDC is stretch.

Domain: units six decimals distinct from money; double entry covering cash/assets/fees with consistent dimensions; T+1 settled versus available cash, no withdrawal of unsettled proceeds; buy tax lots, FIFO or specific-ID sells, realized/unrealized gains; dividend declared/ex/pay dates and late restatement; 2-for-1 split doubles units, halves per-unit basis, preserves value/return; choose and defend time-weighted versus money-weighted return, deposits are not returns; corrected close three days ago restates return while as-published and as-corrected remain queryable; rebalance drift/minimums/fractional rules/cash buffer/partial fills overnight; daily positions/cash/transactions breaks with aging on screen.

Live fire: onboard/link/deposit/invest at broker; corrected close; split; replay fill without doubled position; deposit bounces after investment; planted position mismatch. Suggested order: dimensional ledger, Alpaca/Plaid day one, valuation/returns, restatement with real time budget. Stretch: USDC/idle cash, recurring deposits, model versioning, tax PDF, adviser bulk approvals, performance-fee accrual. Hardest: returns under flows/corrections, lots and reconciliation.

## Track 3: Neobank

Core: business and director checks before account activation, linked funding, real sandbox issuing, authorize and settle for different amount days later, checker-approved outbound payment, reversed settlement and scheme reconciliation.

Live required: issuing (Lithic/Stripe Issuing/Marqeta) and business/director KYB/KYC (pending/rejected shown). Payment rails with delayed settlement/returns and linked-bank funding may be simulated. Testnet USDC cross-border payout is first-class, live strongly preferred, not merely an optional stretch. USD cents ledger independent of rail. An accepted FX quote is on the stretch ladder.

Domain: ledger versus available = ledger minus active holds with explicit uncleared-credit policy, derived from events rather than second authoritative stored balance; authorization, incremental authorization, partial/multiple/over-capture, expiry and reversal, hold releases exactly once; later different capture and force-post without auth; settlement before auth is parked/matched without double counting; returned outbound and recalled inbound payments correct relevant historical position; value date and booking date are separate: Thursday reversal of Tuesday settlement produces corrected Tuesday statement and preserves what was believed Wednesday; reproducible closed-day statements; standing orders fire once across restarts/retries with insufficient-funds policy; nightly scheme in-file-not-ledger, in-ledger-not-file, amount mismatch and aging; maker-checker cannot be bypassed by initiator or agent.

Live fire: $50 auth affects available not ledger; $73.40 capture two days later releases hold once; reverse next day and inspect settlement-day statement; settlement-before-auth; self-approval attack; missing scheme row; issuing webhooks off five minutes and honest customer state. Suggested order: ledger/holds on paper then code, issuing day one, bitemporality early, statements/breaks. First-class, live strongly preferred: testnet USDC payout. The stretch ladder adds an accepted FX quote to that payout, plus real-time card controls within provider timeout, daily fees/interest, pots/internal transfers, dispute/provisional credit, payee confirmation. Hardest: hostile hold sequencing, bitemporal correction, derived available balance.

## Interpretation boundaries

Clarify immutable published statements versus corrected views by preserving publication revisions and distinguishing effective time from knowledge/publication time; do not assume an unanswered interpretation is official. Never invent tax rates, refund policies, legal duties or live sandbox access. Verify current primary sources for the actual selected product and provider. Technical review is not blanket legal certification.
