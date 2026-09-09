"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// The animated shell of "explain this amount" (slice B12-4, Linear YOA-637, asked for by Yoann on
// 2026-09-09: an explanation you can watch being built, from the figure down to the ledger line).
//
// THE RULE THIS FILE OBEYS, AND THE REASON IT IS THE ONLY CLIENT COMPONENT IN THE FEATURE:
// the browser never computes a money figure. Every figure it shows AT REST is a string the server
// rendered, arriving either as a prop or in a data attribute, and this file decides WHEN such a
// string appears, never WHAT it says.
//
// The count-up is the one exception and it is worth being exact about (review finding F-B12-13):
// while it runs, THE BROWSER DOES DO ARITHMETIC. It reads the digits of the server-rendered text
// as a number and multiplies it by a fraction of the animation to pick each intermediate frame, so
// those frames are strings the browser composed. They are frames of a count, not amounts: no
// figure this application states, stores, posts or totals is ever produced here, and the frame the
// count stops on is the server's own text, put back verbatim.
// lib/money/amount-explained-motion.test.ts asserts this against the source of this file: one
// number, read from those digits, and nowhere else.
//
// WITH JAVASCRIPT OFF nothing here runs and nothing is hidden: the drawer is a native <details>
// whose summary is the figure, so the browser opens and closes it on its own, and the panel
// carries no data-reveal attribute, so the CSS that hides a line before its turn never applies
// (app/globals.css hides only inside a panel that HAS that attribute). What that reader loses is
// the two conveniences that need a script anywhere in this build: Escape and the click outside.
//
// THE PANEL MOVED OUT OF THE CELL on 2026-09-09 (interface system): it used to be a <details>
// expanding inside the table cell it sits in, where the horizontal scroll container of the table
// clipped it. IT IS THE DRAWER SINCE CYCLE 2 (Yoann, decision 6): the same panel as the inspector,
// over the content on the right, closed by its cross, by a click outside or by Escape. A popover
// anchored to the figure covered half the screen wherever the figure happened to sit; the drawer
// always comes from the same edge, so a reader learns one way of opening a detail and one way out.
// The panel's own markup, the formula it prints and the reveal below are unchanged.

// The four lines of the reveal, in order. Shortened from 120 ms in cycle 2: the panel used to sit
// on screen, empty but for its title, for more than a second before its first line arrived
// (round 1, MEDIUM). It now opens on step 1, so the words are there the moment it appears.
const STEP_INTERVAL_MS = 70;
// One operand of the formula table lights up every 70 ms once the table's turn comes.
const OPERAND_INTERVAL_MS = 70;
// How long the result takes to count up to the figure.
const COUNT_UP_MS = 600;
// How long the proving journal entry stays highlighted, and how long the connector stays drawn.
const PULSE_MS = 1500;
const CONNECTOR_MS = 1800;
// How long a smooth scroll is given to settle before the connector is measured.
const SCROLL_SETTLE_MS = 450;

// Where the connector starts and ends, in viewport pixels. Positions, never money.
type ConnectorGeometry = { fromX: number; fromY: number; toX: number; toY: number };

export function AmountExplainedMotion({
  finalText,
  label,
  size,
  traceEntryElementId,
  hasTicker,
  inWords,
  formula,
  rounding,
  evidence,
}: {
  // The figure, already formatted by the server (lib/money/cents.ts). It is shown as-is and is the
  // text the count-up ends on.
  finalText: string;
  // What the figure is, so the summary that opens the panel is named by more than its digits.
  label: string;
  size: "figure" | "inline";
  // The id of the journal entry block on this page that proves the figure, when there is one.
  // The connector is drawn to it and the "Trace to the ledger" link jumps to it.
  traceEntryElementId?: string;
  // Whether the formula table carries running subtotals (data-subtotal on its rows). Only a fold
  // whose lines really add up to its figure has them; see runningSubtotals in lib/money/explain.ts.
  hasTicker: boolean;
  // The four revealed parts, all rendered on the server.
  inWords: ReactNode;
  formula: ReactNode;
  rounding: ReactNode;
  evidence: ReactNode;
}) {
  // False until hydration: the server-rendered HTML must be the version that works without us.
  const [enhanced, setEnhanced] = useState(false);
  // Whether the drawer is on screen, as the browser reports it on the details element's toggle.
  // It is read here only to bind Escape while the panel is open; the opening itself is the
  // browser's, not ours.
  const [open, setOpen] = useState(false);
  // 1 = the words are on screen, 4 = the whole panel. The CSS reads it from data-reveal. It
  // starts at 1 rather than 0, so the drawer is never an empty box while it is on screen.
  const [revealStep, setRevealStep] = useState(1);
  // What the running-total line says right now. Always a string taken from a data-subtotal
  // attribute the server wrote.
  const [tickerText, setTickerText] = useState<string | null>(null);
  const [connector, setConnector] = useState<ConnectorGeometry | null>(null);

  // The figure itself, inside the summary that opens the panel: the connector starts from its box.
  const figureRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The <details> that IS the drawer: opening it is what the browser does on a click, with or
  // without us, and closing it is what the cross, the backdrop and Escape ask for.
  const drawerRef = useRef<HTMLDetailsElement>(null);
  // This fold's own element, so it can tell whether it is the first fold on the page pointing at
  // its journal entry. See the hash effect below (review finding F-B12-20).
  const foldRef = useRef<HTMLSpanElement>(null);
  // Every timer and animation frame this component started, so closing the fold or leaving the
  // page stops all of them. Without this a half-finished count-up would keep writing into a cell.
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const frameRef = useRef<number | null>(null);

  useEffect(() => setEnhanced(true), []);

  function stopEverything() {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }

  function later(callback: () => void, delayMs: number) {
    timersRef.current.push(setTimeout(callback, delayMs));
  }

  useEffect(() => stopEverything, []);

  // A reader who arrives on the address of the proving entry, or who follows the "Trace to the
  // ledger" link of a page that was already loaded, lands on a block that may be inside a closed
  // fold (review finding F-B12-12). Browsers differ on whether a fragment opens the <details> that
  // holds it, so one fold opens it and lights it.
  //
  // ONE ARRIVAL, ONE ENTRY, ONE FOLD (review finding F-B12-20). The hash names exactly one entry,
  // but SEVERAL FOLDS ON A PAGE CAN NAME THE SAME ENTRY: on CGP-01274, $54.33 and $25.00 are both
  // proved by one journal entry. Without the test below, one arrival ran the whole routine once
  // per fold: two smooth scrolls, two timers racing to remove one class, and two connectors drawn
  // from two different figures to the same block. The first fold of the page pointing at that
  // entry answers for all of them; document order is what querySelectorAll returns, so the answer
  // is the same on every visit and needs no shared state.
  useEffect(() => {
    if (!traceEntryElementId) return;
    const openWhenTargeted = () => {
      if (window.location.hash !== `#${traceEntryElementId}`) return;
      const firstFoldForThisEntry = Array.from(
        document.querySelectorAll<HTMLElement>("[data-trace-entry]"),
      ).find((fold) => fold.dataset.traceEntry === traceEntryElementId);
      if (firstFoldForThisEntry && firstFoldForThisEntry !== foldRef.current) return;
      traceToLedger();
    };
    openWhenTargeted();
    window.addEventListener("hashchange", openWhenTargeted);
    return () => window.removeEventListener("hashchange", openWhenTargeted);
  }, [traceEntryElementId]);

  // The reader asked not to be animated. Checked at the moment the fold opens rather than once at
  // mount, because the setting can change while the page is open.
  function prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // ---- the count-up ---------------------------------------------------------------------------
  // The result cell already holds the server's text and keeps it in data-final-amount. The
  // animation borrows the cell for 600 ms to draw the intermediate frames, then writes that exact
  // text back. Nothing else in the application reads this cell.
  function countUpResultCell(resultCell: HTMLElement) {
    // NO FALLBACK (review finding F-B12-15). A cell that does not carry the server's own string is
    // not animated at all. Falling back to its current text would mean that a cell interrupted
    // mid-count could be read back as "the server's text" on the next open, and a frame of the
    // count would become the permanent content of a money cell.
    const textFromServer = resultCell.dataset.finalAmount;
    if (!textFromServer) {
      return;
    }
    const digits = textFromServer.replace(/[^0-9]/g, "");
    if (digits === "") {
      return;
    }
    // THE ONLY NUMBER THIS FILE READS, and it is read from the digits of the text above, for no
    // purpose but choosing which digits to draw on the way there.
    const digitsAsNumber = Number(digits);
    const startedAt = performance.now();
    const drawFrame = (now: number) => {
      const progress = Math.min((now - startedAt) / COUNT_UP_MS, 1);
      if (progress >= 1) {
        // The last frame is the server's text itself, not a rebuilt one.
        resultCell.textContent = textFromServer;
        frameRef.current = null;
        return;
      }
      // Fast at first, slowing to a stop: a ratio applied to a position in the animation.
      const eased = 1 - Math.pow(1 - progress, 3);
      const drawn = String(Math.floor(digitsAsNumber * eased)).padStart(digits.length, "0");
      resultCell.textContent = replaceDigits(textFromServer, drawn);
      frameRef.current = requestAnimationFrame(drawFrame);
    };
    frameRef.current = requestAnimationFrame(drawFrame);
  }

  // ---- the connector and the pulse ------------------------------------------------------------
  // NOTHING HERE OPENS A FOLD OR MOVES THE PAGE ON ITS OWN (review finding F-B12-11). The first
  // version ended every reveal by opening every <details> above the target, which on a policy with
  // more than four entries expanded the whole journal under the reader and then drew a connector
  // to a block below the fold. Opening the journal is now something the reader asks for, once, by
  // following "Trace to the ledger".

  // The journal entry this fold points at, if it is on the page at all.
  function ledgerTarget(): HTMLElement | null {
    return traceEntryElementId ? document.getElementById(traceEntryElementId) : null;
  }

  // Whether the entry can be seen WITHOUT opening anything: no closed <details> above it, and its
  // top edge (where the connector lands) inside the viewport.
  function isOnScreenWithoutOpening(target: HTMLElement): boolean {
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open) return false;
    }
    const box = target.getBoundingClientRect();
    return box.top >= 0 && box.top < window.innerHeight && box.left >= 0 && box.right <= window.innerWidth;
  }

  function pulse(target: HTMLElement) {
    target.classList.add("entry-proving");
    later(() => target.classList.remove("entry-proving"), PULSE_MS);
  }

  // The curve, drawn only when the reader can actually see both of its ends. Anything else would
  // be a line pointing off the page.
  function drawConnectorIfBothEndsVisible(target: HTMLElement) {
    if (prefersReducedMotion()) return;
    const figure = figureRef.current;
    if (!figure) return;
    const from = figure.getBoundingClientRect();
    if (from.bottom < 0 || from.top > window.innerHeight) return;
    if (!isOnScreenWithoutOpening(target)) return;
    const to = target.getBoundingClientRect();
    setConnector({
      fromX: from.left + from.width / 2,
      fromY: from.bottom,
      toX: to.left + Math.min(to.width / 2, 120),
      toY: to.top,
    });
    later(() => setConnector(null), CONNECTOR_MS);
  }

  // End of the reveal. If the proving entry happens to be visible already, it is pointed at and
  // lit. If it is not, nothing happens at all: the "Trace to the ledger" link is there for that.
  function pointAtLedgerIfAlreadyVisible() {
    const target = ledgerTarget();
    if (!target || !isOnScreenWithoutOpening(target)) return;
    pulse(target);
    drawConnectorIfBothEndsVisible(target);
  }

  // The one action that is allowed to change the page: the reader asked to be taken to the entry.
  // It opens the folds the entry is hidden in, scrolls to it, lights it, and draws the connector
  // only if the figure is still on screen once the scrolling has settled.
  function traceToLedger() {
    const target = ledgerTarget();
    if (!target) return;
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    }
    const reduced = prefersReducedMotion();
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    // Smooth scrolling is not finished when this returns, so the measurement waits for it.
    later(() => {
      pulse(target);
      drawConnectorIfBothEndsVisible(target);
    }, reduced ? 0 : SCROLL_SETTLE_MS);
  }

  // ---- the reveal -----------------------------------------------------------------------------
  function runReveal() {
    stopEverything();
    const panel = panelRef.current;
    if (!panel) return;
    const operandRows = Array.from(panel.querySelectorAll<HTMLElement>("tr[data-formula-line]:not([data-formula-result])"));
    const resultCell = panel.querySelector<HTMLElement>("tr[data-formula-result] td.amount");

    if (prefersReducedMotion()) {
      // Everything at once, in its final state: no stagger, no count-up, no connector. The proving
      // entry is still marked when it is already visible (review finding F-B12-16), with the flat
      // colour the reduced-motion CSS gives it instead of a pulse, so this reader is not the only
      // one who never learns which entry proves the figure.
      for (const row of operandRows) row.classList.add("operand-lit");
      setRevealStep(4);
      setTickerText(lastSubtotalOf(operandRows));
      pointAtLedgerIfAlreadyVisible();
      return;
    }

    for (const row of operandRows) row.classList.remove("operand-lit");
    // Step 1 is already on screen when the drawer opens: the panel used to reserve its full height
    // and stay blank for over a second (round 1, MEDIUM), which read as a broken panel. Step 2 is
    // the arithmetic in integer cents, operand by operand. Step 3 is the rounding rule. Step 4 is
    // the result line, which counts up to the figure and points at the entry that proves it.
    setRevealStep(1);
    setTickerText(null);
    later(() => {
      setRevealStep(2);
      operandRows.forEach((row, rank) => {
        later(() => {
          row.classList.add("operand-lit");
          const subtotal = row.getAttribute("data-subtotal");
          if (subtotal !== null) setTickerText(subtotal);
        }, rank * OPERAND_INTERVAL_MS);
      });
    }, STEP_INTERVAL_MS);
    later(() => setRevealStep(3), STEP_INTERVAL_MS * 2);
    later(() => {
      setRevealStep(4);
      if (resultCell) countUpResultCell(resultCell);
      later(pointAtLedgerIfAlreadyVisible, COUNT_UP_MS);
    }, STEP_INTERVAL_MS * 3 + operandRows.length * OPERAND_INTERVAL_MS);
  }

  function closeReveal() {
    stopEverything();
    setConnector(null);
    setRevealStep(1);
    const panel = panelRef.current;
    if (!panel) return;
    for (const row of panel.querySelectorAll<HTMLElement>("tr[data-formula-line]")) {
      row.classList.remove("operand-lit");
    }
    // Whatever frame the count-up stopped on, the cell goes back to the server's text. It is the
    // same attribute the count refused to start without, so there is always one to go back to.
    const resultCell = panel.querySelector<HTMLElement>("tr[data-formula-result] td.amount");
    if (resultCell?.dataset.finalAmount) resultCell.textContent = resultCell.dataset.finalAmount;
  }

  // THE BROWSER OWNS THE PANEL. The drawer is a native <details>, so a click on the figure opens
  // it whether or not any of this ran, and the reveal below is what we add on top: it starts when
  // the browser says the details opened, and it is torn down when the details closes.
  function closeDrawer() {
    if (drawerRef.current) drawerRef.current.open = false;
  }

  function onDrawerToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    const isOpen = event.currentTarget.open;
    setOpen(isOpen);
    if (!isOpen) {
      closeReveal();
      return;
    }
    // One explanation at a time: a second drawer over the first would stack two panels on the
    // same edge of the screen.
    for (const other of document.querySelectorAll<HTMLDetailsElement>("details.amount-explained-drawer[open]")) {
      if (other !== drawerRef.current) other.open = false;
    }
    runReveal();
  }

  // Escape closes it, the way it closes the inspector's drawer.
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <span
      ref={foldRef}
      className={size === "inline" ? "amount-explained inline" : "amount-explained"}
      // The entry this fold points at, readable from the DOM: it is how the folds of a page tell
      // which of them answers a fragment arrival (F-B12-20). Presentation only, nothing reads it
      // for a figure.
      data-trace-entry={traceEntryElementId}
    >
      <details ref={drawerRef} className="amount-explained-drawer" onToggle={onDrawerToggle}>
        <summary className="amount-explained-figure" aria-label={`${label}: explain this amount`}>
          <span
            ref={figureRef}
            // The final text, in the HTML whether the browser runs anything or not. The count-up
            // ends on it and the reviewer can read it in the page source.
            data-final-amount={finalText}
          >
            {finalText}
          </span>
        </summary>
        {/* The three ways out of the drawer, the same three as the inspector's: this backdrop,
            the cross beside the title, and Escape. Decorative: the cross is the labelled control,
            this one only catches the click outside. */}
        <span className="drawer-backdrop pd-drawer-backdrop" aria-hidden="true" onClick={closeDrawer} />
        <aside className="drawer" aria-label={label}>
          <div className="drawer-head">
            <div>
              <div className="drawer-kind">Explain this amount</div>
              <h2>{label}</h2>
            </div>
            <button type="button" className="drawer-close pd-drawer-close" aria-label="Close" onClick={closeDrawer}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="drawer-body">
            <div
              ref={panelRef}
              className="amount-explain-panel"
              // Absent until hydration, and absent for a reader with no JavaScript: the CSS that hides
              // a line before its turn only applies inside a panel carrying this attribute.
              data-reveal={enhanced ? revealStep : undefined}
            >
              <div className="reveal-step reveal-step-1">{inWords}</div>
              <div className="reveal-step reveal-step-2">{formula}</div>
              {enhanced && hasTicker ? (
                <p className="amount-explain-ticker reveal-step reveal-step-2" aria-hidden="true">
                  {/* It rests on the last subtotal, which IS the figure. While the reveal is running
                      it stays blank until the first line lights up, so it never shows a total for
                      lines nobody has seen yet. */}
                  <span>Running total</span> <b>{tickerText ?? "\u00a0"}</b>
                </p>
              ) : null}
              <div className="reveal-step reveal-step-3">{rounding}</div>
              <div className="reveal-step reveal-step-4">
                {evidence}
                {traceEntryElementId ? (
                  <p className="trace-to-ledger">
                    <a
                      href={`#${traceEntryElementId}`}
                      onClick={(event) => {
                        // The browser would jump. We open any fold the entry is hidden in, scroll and
                        // light it up. With JavaScript off the same link still jumps to the entry.
                        event.preventDefault();
                        traceToLedger();
                      }}
                    >
                      Trace to the ledger
                    </a>
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </details>
      {connector ? createPortal(<ConnectorLine geometry={connector} />, document.body) : null}
    </span>
  );
}

// A thin line drawn from the figure to the journal entry that proves it, over the page and
// touching nothing (pointer-events: none, aria-hidden). It is placed in the body so no scrolling
// container can clip it. The drawing itself is one CSS animation on stroke-dashoffset; pathLength
// = 1 lets the dash length be 1 whatever the real length of the curve is.
function ConnectorLine({ geometry }: { geometry: ConnectorGeometry }) {
  const midY = (geometry.fromY + geometry.toY) / 2;
  const curve = `M ${geometry.fromX} ${geometry.fromY} C ${geometry.fromX} ${midY} ${geometry.toX} ${midY} ${geometry.toX} ${geometry.toY}`;
  return (
    <svg className="explain-connector" aria-hidden="true" focusable="false">
      <path d={curve} pathLength={1} />
      <circle cx={geometry.toX} cy={geometry.toY} r={4} />
    </svg>
  );
}

// The same text with its digits swapped for `digits`, one for one, left to right: "$2,033.30" and
// "001234" give "$0,012.34". The dollar sign, the comma, the point and any minus sign stay where
// the server put them, and the width never changes, so the row does not jump while it counts.
function replaceDigits(text: string, digits: string): string {
  let position = 0;
  return text.replace(/[0-9]/g, () => {
    const digit = digits[position] ?? "0";
    position += 1;
    return digit;
  });
}

// The running total the ticker rests on: the one written on the last operand row by the server.
function lastSubtotalOf(rows: HTMLElement[]): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const subtotal = rows[index].getAttribute("data-subtotal");
    if (subtotal !== null) return subtotal;
  }
  return null;
}
