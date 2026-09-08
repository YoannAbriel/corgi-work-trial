// The operations this system never delegates to an agent, and why.
//
// The general brief asks for this list in writing. It is code rather than prose so it cannot
// drift away from the surface it describes: `tools/list` returns it under `policy`, the
// `initialize` answer repeats it in its instructions, and a unit test asserts that no tool is
// named after an operation on this list.
//
// THE RULE BEHIND THE LIST, in one sentence: an agent may read anything its key's user may
// read, and may ASK for exactly one thing (a claim payment), which a human then decides. Every
// operation that moves money, changes who is eligible, or ends a human's decision is out.
//
// It is not a permission model. The permission model is the code: there is simply no tool for
// any of these, /api/approvals accepts session cookies and never an API key, and the database
// trigger on approval_decisions (migration 0008) refuses any decider whose role is not
// staff_approver. The list says out loud what those three facts add up to.

export type NeverDelegatedOperation = {
  operation: string;
  reason: string;
};

export const NEVER_DELEGATED: NeverDelegatedOperation[] = [
  {
    operation: "approve or reject a money-out request",
    reason:
      "maker-checker exists so that a second HUMAN looks at money leaving. An agent deciding would be the same actor twice. There is no tool for it, the approval route accepts session cookies only, and the database refuses a decision by anyone whose role is not staff_approver.",
  },
  {
    operation: "send a claim payment on the payout rail",
    reason:
      "this is money leaving. An agent may ask for one with request_claim_payment; a staff operator sends it from the claim screen, after an approver has said yes when it is above the threshold.",
  },
  {
    operation: "issue or re-issue a refund at Stripe",
    reason: "money leaving again, with the same rule: a human cancels the policy and a human sends the refund.",
  },
  {
    operation: "bind a policy",
    reason:
      "binding commits cover and creates the premium the customer owes. It also depends on the broker's KYB eligibility, which is checked at the moment of binding by a person who can see why it failed.",
  },
  {
    operation: "cancel a policy",
    reason: "a cancellation stops cover and computes a refund. It is a customer decision carried out by a person.",
  },
  {
    operation: "void a binding or record a correction",
    reason:
      "a correction rewrites what the ledger says happened (as reversals plus a re-book). Nobody should be able to correct history without a person naming the reason.",
  },
  {
    operation: "run or publish a broker statement",
    reason:
      "a published statement is what we told a broker they were owed. Choosing its knowledge cutoff is a judgement call, so staff run it and agents read the result.",
  },
  {
    operation: "change a broker's KYB status, or submit a verification",
    reason:
      "eligibility comes from the provider's own decision and from the documents a broker really signed. Nothing an agent asserts may move it.",
  },
  {
    operation: "create, revoke or read an MCP API key",
    reason:
      "an agent that could mint keys could grant itself another user's visibility. Keys are created and revoked by staff on /ops/mcp-keys, or by a script run by a person.",
  },
  {
    operation: "replay a webhook, or write anything into the ledger directly",
    reason:
      "journal entries are posted by the business operations that cause them. There is no general write tool, and the runtime database role holds SELECT and INSERT only on every money table.",
  },
];

// One sentence for the client that reads the surface. Kept short on purpose: an agent reading
// tools/list should get the rule, not an essay.
export const NEVER_DELEGATED_SUMMARY =
  "Read tools answer with exactly what the key's user may see. The only write tool puts a claim payment into the human approval queue: it never moves money. Approving, sending, binding, cancelling, correcting, publishing a statement, changing KYB and managing API keys are never delegated to an agent.";
