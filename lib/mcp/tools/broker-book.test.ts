import { test } from "node:test";
import assert from "node:assert/strict";
import { brokerBookHeader, brokerBookSentence } from "./broker-book";

// Review finding F-INSPECT-01. A reference that resolves to a broker (an acct_ id, or a
// correlation id whose newest object-naming request named a broker) used to be answered with the
// broker's NEWEST policy in the header: a policy number, a cached status, a term and four terms
// in force, printed beside money operations, journal entries and requests read across the
// broker's WHOLE book. The header and the sentence below are the rule that replaced it. They are
// pure, so they are proved here as a rule; scripts/check-mcp.ts proves the same thing over HTTP
// on a real broker with a real book.

const BROKER = "11111111-1111-1111-1111-111111111111";

const bookOfThree = {
  id: BROKER,
  brokerId: BROKER,
  policyIds: [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "cccccccc-cccc-cccc-cccc-cccccccccccc",
  ],
};

test("a broker file names no policy: every policy field is null", () => {
  const header = brokerBookHeader(bookOfThree);
  assert.equal(header.policyId, null);
  assert.equal(header.policyNumber, null);
  assert.equal(header.policyStatus, null);
  assert.equal(header.term, null);
  assert.equal(header.termsInForceToday, null);
});

test("a broker file says it is a whole book, and how many policies the lists came from", () => {
  const header = brokerBookHeader(bookOfThree);
  assert.equal(header.kind, "broker");
  assert.equal(header.brokerId, BROKER);
  assert.equal(header.spansAWholeBrokerBook, true);
  assert.equal(header.policiesTheseListsWereDrawnFrom, 3);
});

test("a broker with no policy at all is a book of zero, not a missing header", () => {
  const header = brokerBookHeader({ id: BROKER, brokerId: null, policyIds: [] });
  assert.equal(header.brokerId, BROKER);
  assert.equal(header.spansAWholeBrokerBook, true);
  assert.equal(header.policiesTheseListsWereDrawnFrom, 0);
});

test("the sentence says the lists span the book, with the count and the cap", () => {
  const sentence = brokerBookSentence(3);
  assert.match(sentence, /BROKER, not to one policy/);
  assert.match(sentence, /span that broker's whole book/);
  assert.match(sentence, /drawn from 3 policies/);
  assert.match(sentence, /200 newest at most/);
  assert.match(sentence, /names no policy number/);
});

test("one policy is written as one policy, not as one policies", () => {
  assert.match(brokerBookSentence(1), /drawn from 1 policy \(/);
});
