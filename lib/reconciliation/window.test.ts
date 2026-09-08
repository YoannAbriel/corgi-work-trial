import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultWindow, MAX_WINDOW_DAYS, parseWindow, unixSeconds, WindowRefused } from "./window";

const NOW = new Date("2026-09-08T12:00:00Z");

test("the default window is the last seven days ending now", () => {
  const window = defaultWindow(NOW);
  assert.equal(window.from.toISOString(), "2026-09-01T12:00:00.000Z");
  assert.equal(window.to.toISOString(), "2026-09-08T12:00:00.000Z");
});

test("a missing bound falls back to the default one", () => {
  const window = parseWindow({ from: "2026-09-05" }, NOW);
  assert.equal(window.from.toISOString(), "2026-09-05T00:00:00.000Z");
  assert.equal(window.to.toISOString(), NOW.toISOString());
  const untilYesterday = parseWindow({ to: "2026-09-07T00:00:00Z" }, NOW);
  assert.equal(untilYesterday.from.toISOString(), "2026-09-01T12:00:00.000Z");
  assert.equal(untilYesterday.to.toISOString(), "2026-09-07T00:00:00.000Z");
});

test("empty strings count as missing, which is what an untouched form field sends", () => {
  const window = parseWindow({ from: "", to: "  " }, NOW);
  assert.deepEqual(window, defaultWindow(NOW));
});

test("an empty or inverted window is refused", () => {
  assert.throws(() => parseWindow({ from: "2026-09-08", to: "2026-09-08" }, NOW), WindowRefused);
  assert.throws(() => parseWindow({ from: "2026-09-09", to: "2026-09-08" }, NOW), /must be before/);
});

test("a window longer than the maximum is refused, one exactly at the maximum is accepted", () => {
  assert.throws(() => parseWindow({ from: "2026-07-01", to: "2026-09-01" }, NOW), new RegExp(`at most ${MAX_WINDOW_DAYS} days`));
  const longest = parseWindow({ from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" }, NOW);
  assert.equal(longest.from.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("text that is not a date is refused with the field name", () => {
  assert.throws(() => parseWindow({ from: "last tuesday" }, NOW), /"from"/);
});

test("Stripe filters on whole seconds: milliseconds are dropped, never rounded up", () => {
  const wholeSecond = Date.UTC(2026, 8, 8, 12, 0, 0) / 1000;
  assert.equal(unixSeconds(new Date("2026-09-08T12:00:00.000Z")), wholeSecond);
  assert.equal(unixSeconds(new Date("2026-09-08T12:00:00.999Z")), wholeSecond);
});
