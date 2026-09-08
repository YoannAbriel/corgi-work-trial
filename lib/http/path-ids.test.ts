import { test } from "node:test";
import assert from "node:assert/strict";
import { badPathIdResponse, isUuid } from "./path-ids";

test("a uuid the database generated is accepted, in either case", () => {
  assert.equal(isUuid("2f78c23c-17fc-4746-85dd-77f64d6db45a"), true);
  assert.equal(isUuid("2F78C23C-17FC-4746-85DD-77F64D6DB45A"), true);
});

test("anything that is not the canonical form is refused", () => {
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid("2f78c23c17fc474685dd77f64d6db45a"), false); // no dashes
  assert.equal(isUuid("{2f78c23c-17fc-4746-85dd-77f64d6db45a}"), false); // braces
  assert.equal(isUuid("2f78c23c-17fc-4746-85dd-77f64d6db45a "), false); // trailing space
  assert.equal(isUuid("2f78c23c-17fc-4746-85dd-77f64d6db45a; drop table"), false);
});

test("a route with well-formed ids gets no answer to return, and carries on", () => {
  assert.equal(badPathIdResponse({ claim: "2f78c23c-17fc-4746-85dd-77f64d6db45a" }), null);
});

test("a malformed id becomes a 400 that names the id without echoing it", async () => {
  const answer = badPathIdResponse({ claim: "2f78c23c-17fc-4746-85dd-77f64d6db45a", payment: "not-a-uuid" });
  assert.ok(answer);
  assert.equal(answer.status, 400);
  const body = await answer.text();
  assert.match(body, /the payment in this URL is not a valid identifier/);
  assert.doesNotMatch(body, /not-a-uuid/);
});
