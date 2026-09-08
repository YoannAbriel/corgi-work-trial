import { isCalendarDate } from "@/lib/money/dates";

// Whether a loss is covered by the policy it is claimed against: pure date arithmetic, no
// database, so the rule can be read and tested on its own.
//
// A claim can be opened on a BOUND policy, and also on a CANCELLED one, as long as the loss
// happened while the policy was still in force. That second case is the interesting one and it
// is the live-fire question: cancelling a policy does not erase the losses that happened while
// it covered the customer, and the cancellation refund gives back unearned premium only. See
// assertCancellationAllowed in lib/policy/cancel.ts for the other half of the same rule.

export type CoveredPeriod = {
  from: string; // "YYYY-MM-DD", the policy effective date
  to: string; // "YYYY-MM-DD", the term end, or the cancellation date when the policy was cancelled
  endedEarly: boolean; // true when a cancellation shortened the covered period
};

export type PolicyCoverageInput = {
  termStart: string;
  termEnd: string;
  cancelledEffectiveAt: string | null; // null while the policy is not cancelled
};

export function coveredPeriod(input: PolicyCoverageInput): CoveredPeriod {
  if (input.cancelledEffectiveAt !== null && input.cancelledEffectiveAt < input.termEnd) {
    return { from: input.termStart, to: input.cancelledEffectiveAt, endedEarly: true };
  }
  return { from: input.termStart, to: input.termEnd, endedEarly: false };
}

// The reason a loss cannot be claimed on this policy, in words an operator can act on, or null
// when it can. Both ends are inclusive: cover runs from the first day of the term to the last
// day it was in force.
export function claimCoverageRefusal(input: {
  occurredAt: string;
  reportedAt: string;
  // The day the claim is being opened, in UTC. Passed in rather than read from the clock so this
  // function stays pure: the route passes todayUtc(), the checks pass the day of their scenario.
  today: string;
  period: CoveredPeriod;
}): string | null {
  if (!isCalendarDate(input.occurredAt)) {
    return `"${input.occurredAt}" is not a calendar date`;
  }
  if (!isCalendarDate(input.reportedAt)) {
    return `"${input.reportedAt}" is not a calendar date`;
  }
  if (input.reportedAt < input.occurredAt) {
    return "a loss cannot be reported before the day it happened";
  }
  // A loss that has not happened yet cannot be claimed (review finding F-B7-06). Checked before
  // the covered period, because "this has not happened" is the truer answer to give an operator
  // than "this is outside the cover" for a date in the future.
  if (input.occurredAt > input.today) {
    return `the loss is dated ${input.occurredAt}, which has not happened yet: today is ${input.today}`;
  }
  if (input.occurredAt < input.period.from) {
    return `the loss happened on ${input.occurredAt}, before the policy started on ${input.period.from}`;
  }
  if (input.occurredAt > input.period.to) {
    return input.period.endedEarly
      ? `the loss happened on ${input.occurredAt}, after the policy was cancelled on ${input.period.to}`
      : `the loss happened on ${input.occurredAt}, after the policy ended on ${input.period.to}`;
  }
  return null;
}
