import { test } from "node:test";
import assert from "node:assert/strict";
import { replyForRefusedLease } from "./webhook-inbox";

test("an event already handled is acknowledged, so Stripe stops retrying", () => {
  assert.equal(replyForRefusedLease("done").httpStatus, 200);
  assert.equal(replyForRefusedLease("done").retryWanted, false);
  // 'ignored' is handled too: the event was stored, read, and had no money meaning for us.
  assert.equal(replyForRefusedLease("ignored").httpStatus, 200);
  assert.equal(replyForRefusedLease("ignored").retryWanted, false);
});

test("an event still being processed is NOT acknowledged: Stripe must retry", () => {
  // The dangerous case (review finding F-B2-02): a function that died between taking the lease
  // and committing its posting transaction. A 200 here would end the retries and the money
  // would never be posted.
  const reply = replyForRefusedLease("processing");
  assert.equal(reply.httpStatus, 503);
  assert.equal(reply.retryWanted, true);
});

test("an unexpected or missing inbox status fails closed", () => {
  assert.equal(replyForRefusedLease(null).httpStatus, 503);
  assert.equal(replyForRefusedLease("pending").httpStatus, 503);
  assert.equal(replyForRefusedLease("failed").httpStatus, 503);
});
