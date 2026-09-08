import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimPaymentRequesterRefusal,
  isStaff,
  policyVisibilityRefusal,
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

test("staff means the two staff roles and nothing else", () => {
  assert.equal(isStaff(opsKey), true);
  assert.equal(isStaff(approverKey), true);
  assert.equal(isStaff(brokerKey), false);
  assert.equal(isStaff(customerKey), false);
  assert.equal(isStaff(agentKey), false);
});
