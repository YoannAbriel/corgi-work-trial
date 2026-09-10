# Week two, and what I left out

## What I would build first

**1. The investigation panel in the console.** The MCP tools already let an agent take any
reference and walk it back to the operation it belongs to. What is missing is the panel that does
it next to the operator instead of in a terminal. I did not build it because it needs a model
behind it, which costs money this build does not spend, and about five hours the walkthroughs
needed more. It gets the same key limits as any agent: read tools, plus the one write tool that
only queues a request for a human. 5 hours.

**2. Give back parked money.** When a broker loses eligibility between the payment page and the
payment itself, the cash sits in a suspense account so the ledger still matches Stripe to the cent.
Today someone has to apply it or refund it by hand. Sending it back is money going out, so it
belongs in the approval queue that claims and cancellations already use. 3 hours.

**3. Let the customer pay their own bill.** Right now the broker collects for them. The customer
should be able to pay a difference from their own page, through the same Stripe session, so there
is still one operation and one key. 4 hours.

**4. Real sandboxes for the two simulators.** The bank check and the claim payout rail are local
simulators, labelled as such on every screen. The ledger already treats the rail like a real one,
with settlement two days later and returns, so this is swapping where the answers come from, not
building the model. A day each.

**5. Read cost.** The staff inbox and the policy list open each policy one at a time. Fine with the
four policies on the deployed site, about 0.13 seconds each on a test database of a thousand. Batch
it before the book grows. A day.

## What a real product needs before it sells

I checked the build against public California and federal sources. Five things are not modelled,
and none of them is a bug, they are simply outside what 48 hours could cover. Each one is written
up with its source in `docs/reviews/us-rules-check.md`.

- Cancellation notice. California asks for 30 days written notice on a commercial policy, 10 for
  non payment. The app cancels on the date the operator picks, with no notice and no grounds.
- Claim deadlines. Acknowledge in 15 days, accept or deny in 40, pay in 30. The app records
  reserves and payments but has no clock on any of it.
- Producer licence. The broker gate checks the business through Stripe Connect. It does not check
  that anyone holds a licence or is appointed by the insurer, which is what actually lets them sell.
- Sanctions. Nothing screens who is being paid before a claim payment or a refund goes out.
- Electronic delivery. Documents are shown in the portal with no record that the insured agreed to
  receive them that way.

Two more I could not settle either way: whether the flat $25 fee can be fully earned at issuance,
and whether daily pro rata earning matches the accounting standard, which is behind a paywall.

## What is left over

About forty small findings from the reviews, all LOW, all in `docs/reviews/FINDINGS.md` with the
reason each one waited. The bigger clusters are wording on the reconciliation board, details of the
amount explanations, the automatic monthly close, and the interface sweep. None touches money.

Three that matter more than the rest:

- The demo account menu in the sidebar has to go before any real deployment. It saves typing one
  password across six demo accounts, and it is written down as a demo device, but it means a
  session can become the approver in one click.
- The MCP key creation route does not name its rule in the activity log, so refusals show up as
  "none" in the console. One line.
- The reference inspector says a policy is cancelled next to a block about today, when the
  cancellation only takes effect in November. Someone will misread that.

## What I chose not to build

Renewals, a public REST API, a customer portal beyond approvals and documents, ACH, instalments,
e-signature, USDC payouts, a second product, reinsurance.

Left as production work: real KYB, real tax filing, real bank rails, Stripe fee accounting,
sessions you can revoke.

## One thing about this list

It was longer this morning. Three items got built during day two, and a fourth turned out not to
need building because the finding behind it was wrong. That is what I want from a plan like this.
It is a list of things not done yet, with the reason each one waited, and it should shrink when the
reason stops being true.
