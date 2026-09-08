import { test } from "node:test";
import assert from "node:assert/strict";
import { bindingIsAllowed } from "./eligibility";

test("only an approved broker may bind a policy", () => {
  assert.equal(bindingIsAllowed("approved"), true);
});

test("unknown, pending and failed all block binding", () => {
  // A broker with no KYB event at all is "unknown": the absence of a verification is not a
  // permission, so the payment button is refused on the server.
  assert.equal(bindingIsAllowed("unknown"), false);
  assert.equal(bindingIsAllowed("pending"), false);
  assert.equal(bindingIsAllowed("failed"), false);
});
