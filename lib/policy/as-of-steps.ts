// The dates the "as it stood on a date" control steps through (slice B12-3, YOA-626).
//
// Pure: it takes the timeline rows a policy already has and returns the steps. No database, no
// clock, no formatting. That is what makes it testable without a policy, which is why it lives
// here rather than beside the query in lib/policy/correction-read.ts.

export type PolicyAsOfStep = {
  date: string; // "YYYY-MM-DD", the value the ?asOf link carries
  label: string; // what happened that day, in the reader's words
};

// What the function needs to know about one timeline row. `policyTimeline` returns more; only
// these three fields decide whether a row is a step.
export type TimelineRowForSteps = {
  eventType: string;
  effectiveAt: string;
  supersededByEventId: string | null;
};

// An event type that changes what the policy IS on a date, and the word the step wears. A
// correction_reversal is deliberately absent: it carries the WRONG date, the one being put right,
// and offering it as a step would invite a reader to rebuild the policy on a date the correction
// exists to erase. The re-book carries the corrected date and is the step.
const STEP_LABEL: Record<string, string> = {
  endorsed: "endorsement",
  correction_rebook: "corrected endorsement",
  cancelled: "cancellation",
};

// The dates worth asking about on one policy: the term start, every effective date of an event
// still in force, and today. Superseded events are skipped, exactly as the timeline strikes them
// through: the fold no longer applies them, so rebuilding the policy on their date would answer a
// question about a fact that was put right.
//
// TODAY IS ONLY A STEP WHEN THE POLICY IS ALREADY IN FORCE (review finding F-B12-04, same class as
// F-B8-07 and F-B8-09). On a policy whose term starts next week, "today" is before the term start,
// which is the `min` of the date field in the very same panel, and following it printed a refusal:
// a control must not offer a value its own constraint rejects. The term-start step already covers
// the earliest date there is an answer for.
//
// Two steps on the same day become one step with both words, so the row never shows the same date
// twice and the highlight can be decided by date alone.
export function policyAsOfStepsFrom(
  rows: TimelineRowForSteps[],
  termStart: string,
  today: string,
): PolicyAsOfStep[] {
  const labelsByDate = new Map<string, string[]>();
  const addStep = (date: string, label: string): void => {
    const labels = labelsByDate.get(date);
    if (!labels) {
      labelsByDate.set(date, [label]);
      return;
    }
    if (!labels.includes(label)) {
      labels.push(label);
    }
  };

  addStep(termStart, "term start");
  for (const row of rows) {
    if (row.supersededByEventId) {
      continue; // struck through on the timeline: the fold no longer applies it
    }
    const label = STEP_LABEL[row.eventType];
    if (label) {
      addStep(row.effectiveAt, label);
    }
  }
  // Calendar dates are ISO strings of the same length, so comparing them as text compares the days.
  if (today >= termStart) {
    addStep(today, "today");
  }

  return [...labelsByDate.entries()]
    .map(([date, labels]) => ({ date, label: labels.join(", ") }))
    .sort((first, second) => (first.date < second.date ? -1 : first.date > second.date ? 1 : 0));
}
