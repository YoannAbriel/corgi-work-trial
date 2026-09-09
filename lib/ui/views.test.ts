import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  closeInspectorHref,
  inspectHref,
  inspectedReference,
  pickFilter,
  pickView,
  relativeAge,
  toastsFromQuery,
  utcInstant,
  withParams,
} from "./views";

const VIEWS = ["breaks", "runs", "clearing"] as const;

test("pickView answers the first view when the URL names nothing or something unknown", () => {
  assert.equal(pickView(undefined, VIEWS), "breaks");
  assert.equal(pickView("nonsense", VIEWS), "breaks");
  assert.equal(pickView("runs", VIEWS), "runs");
  assert.equal(pickView(["clearing", "runs"], VIEWS), "clearing");
});

test("pickFilter answers null for an absent or unknown value", () => {
  assert.equal(pickFilter(undefined, ["stripe", "claims_rail"]), null);
  assert.equal(pickFilter("paypal", ["stripe", "claims_rail"]), null);
  assert.equal(pickFilter("stripe", ["stripe", "claims_rail"]), "stripe");
});

test("withParams keeps the current query, changes what it is told, and sorts the keys", () => {
  const current = { view: "breaks", source: "stripe", kind: ["money", "webhook"] };
  assert.equal(withParams("/ops/reconciliation", current, { class: "stale" }), "/ops/reconciliation?class=stale&kind=money&kind=webhook&source=stripe&view=breaks");
  assert.equal(withParams("/ops/reconciliation", current, { source: null }), "/ops/reconciliation?kind=money&kind=webhook&view=breaks");
  assert.equal(withParams("/ops/policies", {}, {}), "/ops/policies");
});

test("the inspector opens on a reference and closes by dropping it, filters untouched", () => {
  const current = { view: "feed", since: "2h" };
  const open = inspectHref("/ops/console", current, "pi_3UDKq0K6R3v50tIy1mwQmeWT");
  assert.equal(open, "/ops/console?inspect=pi_3UDKq0K6R3v50tIy1mwQmeWT&since=2h&view=feed");
  assert.equal(closeInspectorHref("/ops/console", { ...current, inspect: "pi_x" }), "/ops/console?since=2h&view=feed");
});

test("inspectedReference trims, bounds and refuses an empty value", () => {
  assert.equal(inspectedReference("  CGP-01707 "), "CGP-01707");
  assert.equal(inspectedReference(""), null);
  assert.equal(inspectedReference("x".repeat(201)), null);
  assert.equal(inspectedReference(undefined), null);
});

test("toastsFromQuery turns the redirect parameters a page knows into notices, nothing else", () => {
  const toasts = toastsFromQuery(
    { error: "Only staff operations may bind", ran: "stripe 12 records", other: "ignored" },
    {
      error: { tone: "error", title: "Refused" },
      ran: { tone: "ok", title: "Reconciliation finished", href: () => "/ops/reconciliation?view=runs", hrefLabel: "See the run" },
    },
  );
  assert.deepEqual(
    toasts.map((toast) => [toast.tone, toast.title, toast.text, toast.param, toast.href]),
    [
      ["error", "Refused", "Only staff operations may bind", "error", undefined],
      ["ok", "Reconciliation finished", "stripe 12 records", "ran", "/ops/reconciliation?view=runs"],
    ],
  );
  assert.deepEqual(toastsFromQuery({ error: "   " }, { error: { tone: "error", title: "Refused" } }), []);
});

test("a rule with a text writes the body itself instead of showing the raw query value", () => {
  const toasts = toastsFromQuery(
    { revoked: "1", produced: "3" },
    {
      // A bare flag: the sentence is fixed and the value never reaches the reader.
      revoked: { tone: "ok", title: "Key revoked", text: "It answers 401 from now on." },
      // A value worth printing: the rule builds the sentence around it.
      produced: { tone: "ok", title: "Statement produced", text: (revision) => `Revision ${revision} produced` },
    },
  );
  assert.deepEqual(
    toasts.map((toast) => [toast.title, toast.text]),
    [
      ["Key revoked", "It answers 401 from now on."],
      ["Statement produced", "Revision 3 produced"],
    ],
  );
});

test("relativeAge reads at a glance and falls back to the date past a month", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  assert.equal(relativeAge(new Date("2026-09-09T11:59:40Z"), now), "just now");
  assert.equal(relativeAge(new Date("2026-09-09T11:51:00Z"), now), "9 min");
  assert.equal(relativeAge(new Date("2026-09-09T09:00:00Z"), now), "3 h");
  assert.equal(relativeAge(new Date("2026-09-07T12:00:00Z"), now), "2 d");
  assert.equal(relativeAge(new Date("2026-07-01T12:00:00Z"), now), "2026-07-01");
  assert.equal(relativeAge(new Date("2026-09-10T12:00:00Z"), now), "2026-09-10");
  assert.equal(utcInstant(new Date("2026-09-09T12:43:39.123Z")), "2026-09-09 12:43:39");
});
