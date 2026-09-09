import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimPaymentRequesterRefusal,
  explanationVisibilityRefusal,
  inspectionVisibilityRefusal,
  isStaff,
  NO_EXPLANATION_FOR_THIS_KEY,
  NO_INSPECTION_FOR_THIS_KEY,
  POLICY_NOT_VISIBLE,
  policyVisibilityRefusal,
  REFERENCE_NOT_IN_THIS_BOOK,
  referenceInBookRefusal,
  staffOnlyRefusal,
  statementBrokerFor,
  type ScopedUser,
} from "./scope";

// What an API key may see. Every one of these rules is also proved over HTTP by
// scripts/check-mcp.ts; here they are proved as rules, one case per line.

const BROKER_A = "11111111-1111-1111-1111-111111111111";
const BROKER_B = "22222222-2222-2222-2222-222222222222";
const CUSTOMER_A = "33333333-3333-3333-3333-333333333333";
const CUSTOMER_B = "44444444-4444-4444-4444-444444444444";

function user(fields: Partial<ScopedUser> & { role: ScopedUser["role"] }): ScopedUser {
  return { id: "user", displayName: "Test user", brokerId: null, customerId: null, ...fields };
}

const brokerKey = user({ role: "broker", brokerId: BROKER_A });
const customerKey = user({ role: "customer", customerId: CUSTOMER_A });
const opsKey = user({ role: "staff_ops" });
const approverKey = user({ role: "staff_approver" });
const agentKey = user({ role: "agent" });

const policyOfA = { brokerId: BROKER_A, customerId: CUSTOMER_A };
const policyOfB = { brokerId: BROKER_B, customerId: CUSTOMER_B };

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

test("a broker key sees its own policies", () => {
  assert.equal(policyVisibilityRefusal(brokerKey, policyOfA), null);
});

test("a broker key does not see another broker's policy", () => {
  assert.match(policyVisibilityRefusal(brokerKey, policyOfB) ?? "", /no policy with that number is visible/);
});

test("an unknown policy and a policy that is not yours give the SAME sentence", () => {
  // Otherwise the tool would answer which policy numbers exist.
  assert.equal(policyVisibilityRefusal(brokerKey, policyOfB), policyVisibilityRefusal(brokerKey, null));
});

test("a customer key sees the policies that cover it, and no others", () => {
  assert.equal(policyVisibilityRefusal(customerKey, policyOfA), null);
  assert.notEqual(policyVisibilityRefusal(customerKey, policyOfB), null);
});

test("both staff roles see every policy", () => {
  assert.equal(policyVisibilityRefusal(opsKey, policyOfB), null);
  assert.equal(policyVisibilityRefusal(approverKey, policyOfB), null);
});

test("an agent principal with no broker and no customer sees nothing", () => {
  // A key is scoped by its USER. A user that is nobody's broker and nobody's customer has no
  // policies, which is what an 'agent' user with no attachment is.
  assert.notEqual(policyVisibilityRefusal(agentKey, policyOfA), null);
});

test("a broker user with no broker attached sees nothing", () => {
  assert.notEqual(policyVisibilityRefusal(user({ role: "broker" }), policyOfA), null);
});

// ---------------------------------------------------------------------------
// The explanation behind a figure (explain_amount)
// ---------------------------------------------------------------------------
//
// Review finding F-MCPTOOLS-05 of round 2: the round-2 gate was proved over HTTP on one figure
// key out of fifteen, for one role out of four, which is why a leak survived a round that was
// about that very gate. The rule is now one line, so it can be walked exhaustively here: every
// role, and the two policies, in five assertions.

test("a customer key is refused the explanation of a figure, whatever the figure and whatever the policy", () => {
  assert.equal(explanationVisibilityRefusal(customerKey), NO_EXPLANATION_FOR_THIS_KEY);
});

test("the customer refusal names the rule and never a figure key or a policy number", () => {
  const refusal = explanationVisibilityRefusal(customerKey) ?? "";
  assert.match(refusal, /no explanation fold, no journal entries and no broker commission/);
  // get_policy_as_of is named on purpose: it is where the amounts legitimately are. A figure key
  // is not, or the refusal would start teaching a caller what to ask for next, and the sentence
  // goes into mcp_calls, which can never be updated, deleted or truncated (F-B11-02).
  assert.match(refusal, /get_policy_as_of/);
  for (const figure of ["commission_payable", "premium_tax", "endorsement_delta"]) {
    assert.ok(!refusal.includes(figure), `the refusal names the figure key "${figure}"`);
  }
});

test("a broker key may explain, and WHICH policies is the policy rule's job, not this one", () => {
  assert.equal(explanationVisibilityRefusal(brokerKey), null);
  // Its own policy: allowed by both rules. Another broker's: allowed by this rule and refused by
  // the policy rule, which is the pair the tool applies in that order.
  assert.equal(policyVisibilityRefusal(brokerKey, policyOfA), null);
  assert.match(policyVisibilityRefusal(brokerKey, policyOfB) ?? "", /no policy with that number is visible/);
});

test("both staff roles may explain any policy", () => {
  assert.equal(explanationVisibilityRefusal(opsKey), null);
  assert.equal(explanationVisibilityRefusal(approverKey), null);
  assert.equal(policyVisibilityRefusal(opsKey, policyOfB), null);
});

test("the rule FAILS CLOSED: a role that is neither broker nor staff is refused", () => {
  // 'agent' is the fifth role of the application. It cannot hold a key on this endpoint today,
  // and this assertion is what keeps a role added tomorrow from being allowed by omission.
  assert.equal(explanationVisibilityRefusal(agentKey), NO_EXPLANATION_FOR_THIS_KEY);
});

test("a broker user with no broker attached passes the role gate and is stopped by the policy gate", () => {
  // The two rules are independent on purpose, and this is the case that shows it: the role is
  // allowed to explain, and there is still no policy it can name.
  const brokerWithoutABroker = user({ role: "broker" });
  assert.equal(explanationVisibilityRefusal(brokerWithoutABroker), null);
  assert.equal(policyVisibilityRefusal(brokerWithoutABroker, policyOfA), POLICY_NOT_VISIBLE);
});

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

test('a broker key reads its own statements with "me"', () => {
  assert.deepEqual(statementBrokerFor(brokerKey, "me"), { brokerId: BROKER_A });
  assert.deepEqual(statementBrokerFor(brokerKey, BROKER_A), { brokerId: BROKER_A });
});

test("a broker key cannot read another broker's statement", () => {
  assert.deepEqual(statementBrokerFor(brokerKey, BROKER_B), {
    refusal: 'a broker key can only read its own statements; pass "me"',
  });
});

test("a staff key names the broker it wants", () => {
  assert.deepEqual(statementBrokerFor(opsKey, BROKER_B), { brokerId: BROKER_B });
});

test('a staff key has no "me"', () => {
  assert.deepEqual(statementBrokerFor(opsKey, "me"), { refusal: "a staff key has no broker of its own; pass the broker id" });
});

test("a customer key has no commission account to read", () => {
  assert.deepEqual(statementBrokerFor(customerKey, "me"), {
    refusal: 'only a broker or staff can read a broker statement; this key belongs to a "customer"',
  });
});

// ---------------------------------------------------------------------------
// Staff-only surfaces, and who may ask for a claim payment
// ---------------------------------------------------------------------------

test("reconciliation is staff only", () => {
  assert.equal(staffOnlyRefusal(opsKey, "read reconciliation breaks"), null);
  assert.equal(staffOnlyRefusal(approverKey, "read reconciliation breaks"), null);
  assert.match(staffOnlyRefusal(brokerKey, "read reconciliation breaks") ?? "", /only staff/);
  assert.match(staffOnlyRefusal(customerKey, "read reconciliation breaks") ?? "", /only staff/);
  assert.match(staffOnlyRefusal(agentKey, "read reconciliation breaks") ?? "", /only staff/);
});

test("only a staff_ops key can ask for a claim payment", () => {
  assert.equal(claimPaymentRequesterRefusal(opsKey), null);
});

test("an approver key cannot ask for a payment it would then have to approve", () => {
  assert.match(claimPaymentRequesterRefusal(approverKey) ?? "", /cannot ask for a payment they would then have to approve/);
});

test("a broker, a customer and a bare agent key cannot ask for a claim payment", () => {
  assert.match(claimPaymentRequesterRefusal(brokerKey) ?? "", /only staff operations/);
  assert.match(claimPaymentRequesterRefusal(customerKey) ?? "", /only staff operations/);
  assert.match(claimPaymentRequesterRefusal(agentKey) ?? "", /only staff operations/);
});

// ---------------------------------------------------------------------------
// The operational file of a reference (inspect_reference)
// ---------------------------------------------------------------------------
//
// Two rules, and they answer two different questions, exactly like the pair explain_amount
// applies: who may open a file at all, and which references that key may open.

test("a customer key is refused the whole tool, whatever the reference", () => {
  assert.equal(inspectionVisibilityRefusal(customerKey), NO_INSPECTION_FOR_THIS_KEY);
});

test("the customer refusal names the rule and points at the tool that does answer it", () => {
  const refusal = inspectionVisibilityRefusal(customerKey) ?? "";
  assert.match(refusal, /never a money operation, a webhook event, a journal entry or a reconciliation report/);
  assert.match(refusal, /get_policy_as_of/);
});

test("the rule FAILS CLOSED: a role that is neither broker nor staff is refused", () => {
  assert.equal(inspectionVisibilityRefusal(agentKey), NO_INSPECTION_FOR_THIS_KEY);
});

test("a broker key and both staff keys may open a file", () => {
  assert.equal(inspectionVisibilityRefusal(brokerKey), null);
  assert.equal(inspectionVisibilityRefusal(opsKey), null);
  assert.equal(inspectionVisibilityRefusal(approverKey), null);
});

test("a broker key opens the references of its own book and nothing else", () => {
  assert.equal(referenceInBookRefusal(brokerKey, BROKER_A), null);
  assert.equal(referenceInBookRefusal(brokerKey, BROKER_B), REFERENCE_NOT_IN_THIS_BOOK);
  // A reference nobody's book owns (a provider record with no operation behind it, a request that
  // named no object) is refused too: unowned means unownable.
  assert.equal(referenceInBookRefusal(brokerKey, null), REFERENCE_NOT_IN_THIS_BOOK);
});

test("the refusal names NOTHING about the reference: not its kind, not its owner, not a number", () => {
  const refusal = referenceInBookRefusal(brokerKey, BROKER_B) ?? "";
  for (const secret of [BROKER_B, "CGP-", "CLM-", "pi_", "claim number", "policy number"]) {
    assert.ok(!refusal.includes(secret), `the refusal names "${secret}"`);
  }
});

test("a staff key opens any reference, including one nobody's book owns", () => {
  assert.equal(referenceInBookRefusal(opsKey, BROKER_B), null);
  assert.equal(referenceInBookRefusal(approverKey, null), null);
});

test("a broker user with no broker attached passes the role gate and owns nothing", () => {
  const brokerWithoutABroker = user({ role: "broker" });
  assert.equal(inspectionVisibilityRefusal(brokerWithoutABroker), null);
  assert.equal(referenceInBookRefusal(brokerWithoutABroker, BROKER_A), REFERENCE_NOT_IN_THIS_BOOK);
  // And not even a reference whose owner is null, which is what a null brokerId would match on a
  // careless equality.
  assert.equal(referenceInBookRefusal(brokerWithoutABroker, null), REFERENCE_NOT_IN_THIS_BOOK);
});

test("staff means the two staff roles and nothing else", () => {
  assert.equal(isStaff(opsKey), true);
  assert.equal(isStaff(approverKey), true);
  assert.equal(isStaff(brokerKey), false);
  assert.equal(isStaff(customerKey), false);
  assert.equal(isStaff(agentKey), false);
});
