"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

// The animated shell of "explain this amount" (slice B12-4, Linear YOA-637, asked for by Yoann on
// 2026-09-09: an explanation you can watch being built, from the figure down to the ledger line).
//
// THE RULE THIS FILE OBEYS, AND THE REASON IT IS THE ONLY CLIENT COMPONENT IN THE FEATURE:
// the browser never computes money. Every string it shows was rendered on the server and arrives
// either as a prop or in a data attribute; this file decides WHEN a string appears, never WHAT it
// says. The count-up is the one place a number is read, and it reads only the digits of the
// server-rendered text so it can draw the intermediate frames; the frame it stops on is that same
// text, put back verbatim. lib/money/amount-explained-motion.test.ts asserts this against the
// source of this file.
//
// WITH JAVASCRIPT OFF nothing here runs and nothing is hidden: the shell server-renders as a
// native <details> with a plain <summary>, the panel carries no data-reveal attribute, and the CSS
// only ever hides a line inside a panel that HAS that attribute (app/globals.css). The figure is a
// <span>; it is promoted to role="button" after hydration, so a control that cannot work is never
// advertised. Nothing changes size when that happens, so the page at rest does not move.

// The four lines of the reveal, in order, one every 120 ms.
const STEP_INTERVAL_MS = 120;
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
  const panelId = useId();
  // False until hydration: the server-rendered HTML must be the version that works without us.
  const [enhanced, setEnhanced] = useState(false);
  const [open, setOpen] = useState(false);
  // 0 = nothing revealed yet, 4 = the whole panel. The CSS reads it from data-reveal.
  const [revealStep, setRevealStep] = useState(0);
  // What the running-total line says right now. Always a string taken from a data-subtotal
  // attribute the server wrote.
  const [tickerText, setTickerText] = useState<string | null>(null);
  const [connector, setConnector] = useState<ConnectorGeometry | null>(null);

  const figureRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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
    const textFromServer = resultCell.dataset.finalAmount ?? resultCell.textContent ?? "";
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
      // Everything at once, in its final state: no stagger, no count-up, no connector.
      for (const row of operandRows) row.classList.add("operand-lit");
      setRevealStep(4);
      setTickerText(lastSubtotalOf(operandRows));
      return;
    }

    for (const row of operandRows) row.classList.remove("operand-lit");
    setRevealStep(0);
    setTickerText(null);
    // Step 1, the words. Step 2, the arithmetic in integer cents, operand by operand. Step 3, the
    // rounding rule. Step 4, the result line, which then counts up to the figure and points at the
    // journal entry that proves it.
    later(() => setRevealStep(1), STEP_INTERVAL_MS);
    later(() => {
      setRevealStep(2);
      operandRows.forEach((row, rank) => {
        later(() => {
          row.classList.add("operand-lit");
          const subtotal = row.getAttribute("data-subtotal");
          if (subtotal !== null) setTickerText(subtotal);
        }, rank * OPERAND_INTERVAL_MS);
      });
    }, STEP_INTERVAL_MS * 2);
    later(() => setRevealStep(3), STEP_INTERVAL_MS * 3);
    later(() => {
      setRevealStep(4);
      if (resultCell) countUpResultCell(resultCell);
      later(pointAtLedgerIfAlreadyVisible, COUNT_UP_MS);
    }, STEP_INTERVAL_MS * 4 + operandRows.length * OPERAND_INTERVAL_MS);
  }

  function closeReveal() {
    stopEverything();
    setConnector(null);
    setRevealStep(0);
    const panel = panelRef.current;
    if (!panel) return;
    for (const row of panel.querySelectorAll<HTMLElement>("tr[data-formula-line]")) {
      row.classList.remove("operand-lit");
    }
    // Whatever frame the count-up stopped on, the cell goes back to the server's text.
    const resultCell = panel.querySelector<HTMLElement>("tr[data-formula-result] td.amount");
    if (resultCell?.dataset.finalAmount) resultCell.textContent = resultCell.dataset.finalAmount;
  }

  function setFoldOpen(shouldBeOpen: boolean) {
    setOpen(shouldBeOpen);
    if (shouldBeOpen) runReveal();
    else closeReveal();
  }

  return (
    <div className={size === "inline" ? "amount-explained inline" : "amount-explained"}>
      <span
        ref={figureRef}
        className="amount-explained-figure"
        // The final text, in the HTML whether the browser runs anything or not. The count-up ends
        // on it and the reviewer can read it in the page source.
        data-final-amount={finalText}
        role={enhanced ? "button" : undefined}
        tabIndex={enhanced ? 0 : undefined}
        aria-expanded={enhanced ? open : undefined}
        aria-controls={enhanced ? panelId : undefined}
        onClick={enhanced ? () => setFoldOpen(!open) : undefined}
        onKeyDown={
          enhanced
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setFoldOpen(!open);
                }
              }
            : undefined
        }
      >
        {finalText}
      </span>
      <details
        className="amount-explain"
        open={open}
        // The <summary> is still a real control: opening the fold from the keyboard or with
        // JavaScript off goes through the browser, and this brings our state back in step.
        onToggle={(event) => {
          const nowOpen = event.currentTarget.open;
          if (nowOpen !== open) setFoldOpen(nowOpen);
        }}
      >
        <summary>
          <ChevronRight size={13} aria-hidden="true" className="disclosure-chevron" />
          <span>Explain this amount</span>
        </summary>
        <div
          id={panelId}
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
              {/* At rest it reads the figure, because the last subtotal IS the figure. While the
                  reveal is running it stays blank until the first line lights up, so it never
                  shows a total for lines nobody has seen yet. */}
              <span>Running total</span> <b>{tickerText ?? (revealStep === 0 ? finalText : "\u00a0")}</b>
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
      </details>
      {connector ? createPortal(<ConnectorLine geometry={connector} />, document.body) : null}
    </div>
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
