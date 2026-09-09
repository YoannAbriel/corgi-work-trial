import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEMO_ACCOUNTS, isDemoAccountEmail } from "./demo-accounts";

// Example: "ops@example.com" is on the list, so a switch to it is allowed; "root@example.com"
// is not, so the route refuses it before touching the database.
test("only the listed demo accounts can be switched to", () => {
  assert.equal(isDemoAccountEmail("ops@example.com"), true);
  assert.equal(isDemoAccountEmail("  OPS@example.com "), true, "case and spaces do not matter");
  assert.equal(isDemoAccountEmail("root@example.com"), false);
  assert.equal(isDemoAccountEmail(""), false);
});

test("the list names the four accounts the login page prints", () => {
  const emails = DEMO_ACCOUNTS.map((account) => account.email);
  for (const printed of ["broker@example.com", "customer@example.com", "ops@example.com", "approver@example.com"]) {
    assert.ok(emails.includes(printed), `${printed} is on the login page and must be switchable`);
  }
});
