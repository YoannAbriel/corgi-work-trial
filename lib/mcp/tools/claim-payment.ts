import { MONEY_OUT_APPROVAL_THRESHOLD_CENTS } from "@/lib/approvals/threshold";
import { ClaimRefused } from "@/lib/claims/claims";
import { requestClaimPayment } from "@/lib/claims/payments";
import { claimPaymentRequesterRefusal } from "@/lib/mcp/scope";
import { requiredText, requiredWholeNumber, ToolRefused, usd, type McpTool } from "./tool";

// request_claim_payment: THE ONLY WRITE TOOL, and it moves no money.
//
// It calls exactly the function a staff operator's click calls, lib/claims/payments.ts
// requestClaimPayment, with the API key's user as the actor. That function writes the intent
// and, above the threshold, the approval request, in one transaction. Nothing reaches the
// payout rail: sending is a separate staff action on the claim screen, which re-reads the
// approval, the destination account and the three ceilings first.
//
// WHY THIS IS SAFE FOR AN AGENT TO HOLD, in the order a reviewer would ask:
//   1. the tool cannot send. There is no send tool, and lib/mcp/never-delegated.ts says so;
//   2. the tool cannot approve. There is no approve tool, /api/approvals accepts session
//      cookies only, and the trigger of migration 0008 refuses any decider whose role is not
//      staff_approver, which an agent principal is not and cannot be (migration 0018 refuses to
//      create an agent key for an approver);
//   3. what the agent asked for is recorded as agent-raised on the immutable request, so the
//      human approver reads "raised by an AGENT" before deciding;
//   4. every ceiling of slice B7 still applies: the claim's reserve, the per-occurrence limit,
//      the policy aggregate, and the cumulative per-claim threshold.

export const requestClaimPaymentTool: McpTool = {
  name: "request_claim_payment",
  title: "Request a claim payment (approval queue only)",
  description:
    "Asks for a payment on a claim. This NEVER moves money: it writes the request and creates an approval request that a distinct human staff approver must decide (always when the key is held by an agent, rule 21; above the cumulative money-out threshold otherwise). A staff operator then sends it from the claim screen. Requires a staff_ops key.",
  inputSchema: {
    type: "object",
    properties: {
      claimNumber: { type: "string", description: "The claim number, for example CLM-00212." },
      amountCents: {
        type: "number",
        description: "The amount to pay, in whole US cents. 120000 means $1,200.00. Never dollars, never a decimal.",
      },
    },
    required: ["claimNumber", "amountCents"],
    additionalProperties: false,
  },
  async run(args, context) {
    const refusal = claimPaymentRequesterRefusal(context.user);
    if (refusal) {
      throw new ToolRefused(refusal);
    }
    const claimNumber = requiredText(args, "claimNumber");
    const amountCents = requiredWholeNumber(args, "amountCents");
    if (amountCents <= 0) {
      throw new ToolRefused('"amountCents" must be a positive whole number of cents');
    }

    const [claim] = await context.database<{ id: string; claim_number: string; policy_number: string }[]>`
      select claim.id, claim.claim_number, policy.policy_number
        from claims claim
        join policies policy on policy.id = claim.policy_id
       where claim.claim_number = ${claimNumber}
    `;
    if (!claim) {
      throw new ToolRefused("no claim with that number is visible to this key");
    }

    let requested;
    try {
      requested = await requestClaimPayment(
        {
          claimId: claim.id,
          amountCents,
          actor: { userId: context.user.id, role: context.user.role },
          requestedThrough: {
            channel: "mcp",
            principalKind: context.principal.principalKind,
            keyPrefix: context.principal.keyPrefix,
          },
        },
        context.database,
      );
    } catch (error) {
      // Every rule of slice B7 answers here: the reserve, the two policy limits, a claim that is
      // closed, an unverified bank account. They are refusals a caller can act on, not failures.
      if (error instanceof ClaimRefused) {
        throw new ToolRefused(error.message);
      }
      throw error;
    }

    const needsApproval = requested.approvalRequestId !== null;
    return {
      claimNumber: claim.claim_number,
      policyNumber: claim.policy_number,
      amount: usd(requested.amountCents),
      moneyOperationId: requested.operationId,
      approvalRequestCreated: needsApproval,
      approvalRequestId: requested.approvalRequestId,
      mustBeDecidedBy: needsApproval
        ? `a user with the role staff_approver, who cannot be ${context.user.displayName} (the requester)`
        : null,
      raisedByAgent: context.principal.principalKind === "agent",
      moneyMoved: false,
      thresholdUsed: usd(MONEY_OUT_APPROVAL_THRESHOLD_CENTS),
      whatThisMeans: needsApproval
        ? `The payment of ${usd(requested.amountCents).formatted} on claim ${claim.claim_number} is waiting in the ` +
          `approval queue. Nothing has left: no journal entry was posted and nothing was sent to the payout rail. ` +
          `A staff approver who is not the requester must approve it on /ops/approvals, and a staff operator then ` +
          `sends it. This tool cannot do either. The threshold is cumulative per claim: what the claim has already ` +
          `paid and what is still waiting count with this amount.`
        : `The payment of ${usd(requested.amountCents).formatted} on claim ${claim.claim_number} is recorded as ` +
          `requested and is below the money-out threshold, so it needs no second person. Nothing has left: a staff ` +
          `operator still has to send it from the claim screen. This tool cannot send it.`,
    };
  },
};
