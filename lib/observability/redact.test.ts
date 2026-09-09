import { test } from "node:test";
import assert from "node:assert/strict";
import { MOST_CHARACTERS_OF_A_MESSAGE, redact, sanitisedSentence } from "./redact";

test("an email is masked to its first three characters", () => {
  assert.equal(redact("no policy for customer@example.invalid"), "no policy for cus****");
  assert.equal(redact("ops@example.com asked twice"), "ops**** asked twice");
});

test("a bearer token never appears, whatever it was", () => {
  const line = redact("refused: Authorization: Bearer cmk_1a2b3c4d.9f8e7d6c5b4a3928");
  assert.match(line, /Bearer \*\*\*\*/);
  assert.doesNotMatch(line, /9f8e7d6c5b4a3928/);
});

test("the reveal cookie never carries its value into a log line", () => {
  // A cookie header, the way one reaches a log by accident: pasted into a bug report, or echoed
  // by a framework error that printed the request.
  const line = redact(
    'request failed: cookie: corgi_session=abc.123.def; mcp_token_reveal=cmk_1a2b3c4d_not_a_real_secret_not_a_real_secret_notreal; other=1',
  );
  assert.doesNotMatch(line, /not_a_real_secret/);
  assert.match(line, /mcp_token_reveal=\*\*\*\*/);
  // What is around it survives: a log line still has to be readable.
  assert.match(line, /other=1/);
});

test("a whole access token is masked down to its public prefix, wherever it appears", () => {
  const line = redact("check: cmk_1a2b3c4d_not_a_real_secret_not_a_real_secret_notreal was refused");
  assert.doesNotMatch(line, /not_a_real_secret/);
  // The prefix is a reference, not a credential, and an operator needs to know which token it was.
  assert.match(line, /cmk_1a2b3c4d_\*\*\*\*/);
  assert.equal(redact("token cmk_1a2b3c4d used"), "token cmk_1a2b3c4d used");
});

test("a password field is replaced, in a form body and in JSON", () => {
  assert.doesNotMatch(redact("email=ops@example.com&password=hunter2"), /hunter2/);
  assert.doesNotMatch(redact('{"password": "hunter2"}'), /hunter2/);
  assert.doesNotMatch(redact("token = 4b7f9a2c1d"), /4b7f9a2c1d/);
});

test("the reveal cookie of a new broker never shows its password", () => {
  // The cookie carries "<email>|<password>" (lib/broker/reveal-cookie.ts). Both halves go.
  const line = redact("set-cookie: broker_password_reveal=new@example.invalid|Xk7RmQpTvW2nBcJdHyFs; Path=/ops/brokers; HttpOnly");
  assert.doesNotMatch(line, /Xk7RmQpTvW2nBcJdHyFs/);
  assert.match(line, /broker_password_reveal=\*\*\*\*/);
  // The rest of the header stays readable: an operator still sees which cookie was set.
  assert.match(line, /Path=\/ops\/brokers/);
});

test("a secret key is masked and a public reference is kept", () => {
  const line = redact("stripe refused sk_test_51QabcDEF for pi_3NxYz and cs_test_a1b2 with whsec_9f8e7d");
  assert.doesNotMatch(line, /51QabcDEF/);
  assert.doesNotMatch(line, /9f8e7d/);
  assert.match(line, /sk_\*\*\*\*/);
  assert.match(line, /whsec_\*\*\*\*/);
  // The references an operator needs during an incident stay readable.
  assert.match(line, /pi_3NxYz/);
  assert.match(line, /cs_test_a1b2/);
});

test("a connection string loses its password", () => {
  const line = redact("connect ECONNREFUSED postgres://app_runtime:s3cr3tpw@db.example.invalid/corgi");
  assert.doesNotMatch(line, /s3cr3tpw/);
  assert.match(line, /\/\/\*\*\*\*:\*\*\*\*@/);
});

test("a message is one line and is capped", () => {
  const line = redact(`first line\nsecond line\t${"x".repeat(1000)}`);
  assert.doesNotMatch(line, /\n/);
  assert.equal(line.length, MOST_CHARACTERS_OF_A_MESSAGE);
});

test("a thrown error contributes its message and never its stack", () => {
  const thrown = new Error("only a staff_approver may decide, and never the maker");
  assert.equal(sanitisedSentence(thrown), "only a staff_approver may decide, and never the maker");
  // A stack names file paths and, through a driver frame, the query and its values.
  assert.ok(thrown.stack && thrown.stack.includes("redact.test.ts"));
  assert.doesNotMatch(sanitisedSentence(thrown), /redact\.test\.ts/);
});

test("a thrown value that is not an Error still becomes a sentence", () => {
  assert.equal(sanitisedSentence("plain string"), "plain string");
  assert.equal(sanitisedSentence(""), "no message");
  assert.equal(sanitisedSentence(undefined), "undefined");
});
