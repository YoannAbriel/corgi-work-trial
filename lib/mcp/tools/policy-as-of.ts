import { documentEventsFromRows, stateName, type PolicyEventRowForDocuments } from "@/lib/documents/from-database";
import { foldPolicyEvents } from "@/lib/documents/policy-as-of";
import { policyVisibilityRefusal } from "@/lib/mcp/scope";
import { isCalendarDate } from "@/lib/money/dates";
import { optionalText, requiredText, ToolRefused, usd, type McpTool } from "./tool";

// get_policy_as_of: the policy as it stood on one business date.
//
// It answers the same question the declarations PDF answers, from the same two functions
// (documentEventsFromRows then foldPolicyEvents), so a figure an agent reads here is the figure
// printed on the document: only the events effective on or before the date count, an event
// undone by a correction is dropped, and between two endorsements the premium and the limits in
// force on that date are the ones shown.
//
// Scope: the owning broker, the covered customer, or staff. A policy the key may not see and a
// policy that does not exist give the SAME sentence, so the tool cannot be used to find out
// which policy numbers exist.

export const getPolicyAsOf: McpTool = {
  name: "get_policy_as_of",
  title: "Policy as of a date",
  effect: "read",
  description:
    "The policy as it stood on a business date: status, term, annual premium in force, state premium tax, policy fee, coverage limits and every endorsement applied by that date. Rebuilt from the policy's immutable events, not from a cache. Scoped to what this API key's user may see.",
  inputSchema: {
    type: "object",
    properties: {
      policyNumber: { type: "string", description: "The policy number, for example CGP-01274." },
      asOf: {
        type: "string",
        description: "Business date, YYYY-MM-DD. Defaults to today (UTC). This is an effective date, not a recording date.",
      },
    },
    required: ["policyNumber"],
    additionalProperties: false,
  },
  async run(args, context) {
    const policyNumber = requiredText(args, "policyNumber");
    const asOf = optionalText(args, "asOf") ?? context.now.toISOString().slice(0, 10);
    if (!isCalendarDate(asOf)) {
      // The value the caller sent is deliberately not repeated: this sentence is written into
      // mcp_calls, which nothing can ever clean (review finding F-B11-02).
      throw new ToolRefused('"asOf" must be a calendar date written as YYYY-MM-DD, for example 2028-03-01');
    }

    const [policy] = await context.database<
      {
        id: string;
        policy_number: string;
        broker_id: string;
        customer_id: string;
        state_code: string;
        broker_name: string;
        customer_name: string;
        customer_email: string;
      }[]
    >`
      select policy.id, policy.policy_number, policy.broker_id, policy.customer_id, policy.state_code,
             broker.name as broker_name, customer.name as customer_name, customer.email as customer_email
        from policies policy
        join brokers broker on broker.id = policy.broker_id
        join customers customer on customer.id = policy.customer_id
       where policy.policy_number = ${policyNumber}
    `;
    const refusal = policyVisibilityRefusal(
      context.user,
      policy ? { brokerId: policy.broker_id, customerId: policy.customer_id } : null,
    );
    if (refusal) {
      throw new ToolRefused(refusal);
    }

    const rows = await context.database<PolicyEventRowForDocuments[]>`
      select id, event_type, to_char(effective_at, 'YYYY-MM-DD') as effective_at, recorded_at,
             supersedes_event_id, payload
        from policy_events
       where policy_id = ${policy.id}
       order by sequence_number
    `;

    let snapshot;
    try {
      const events = documentEventsFromRows(rows, {
        policyNumber: policy.policy_number,
        insuredName: policy.customer_name,
        insuredEmail: policy.customer_email,
        brokerName: policy.broker_name,
        stateCode: policy.state_code,
      });
      snapshot = foldPolicyEvents(events, asOf, context.now.toISOString());
    } catch (error) {
      // A policy not yet in force on that date, or voided, has no state on that date. The reason
      // is returned as the refusal rather than as an empty answer that could read as "no cover".
      //
      // Review finding F-B12-01: "not in force on that date" is only half an answer. The rows are
      // already in hand, so the refusal names the date the cover DOES begin and the caller's next
      // call is a right one. It does not repeat the date the caller sent (finding F-B11-02).
      const reason = error instanceof Error ? error.message : "the policy cannot be rebuilt on that date";
      const firstEffectiveAt = rows.find((row) => row.event_type === "issued")?.effective_at ?? null;
      if (firstEffectiveAt && reason.startsWith("no issued policy event effective on or before")) {
        throw new ToolRefused(
          `this policy was not yet in force on the date asked for: it takes effect on ${firstEffectiveAt}, ` +
            "so ask for that date or a later one.",
        );
      }
      throw new ToolRefused(reason);
    }

    return {
      policyNumber: snapshot.policyNumber,
      asOf: snapshot.asOf,
      status: snapshot.status,
      cancelledEffectiveAt: snapshot.cancelledEffectiveAt,
      broker: snapshot.brokerName,
      insured: snapshot.insuredName,
      state: { code: snapshot.stateCode, name: stateName(snapshot.stateCode) },
      term: { start: snapshot.termStart, end: snapshot.termEnd },
      annualPremium: usd(snapshot.annualPremiumCents),
      annualPremiumAtIssuance: usd(snapshot.annualPremiumCentsAtIssuance),
      premiumTax: { ...usd(snapshot.taxCents), rateBasisPoints: snapshot.taxRateBasisPoints },
      policyFee: usd(snapshot.feeCents),
      totalChargeIfWrittenToday: usd(snapshot.totalChargeCents),
      coverageLimits: snapshot.coverageLines.map((line) => ({
        name: line.name,
        limit: usd(line.limitCents),
        description: line.description,
      })),
      // The premium segments: issuance plus one per endorsement applied by this date. Each one
      // earns over its own window, which is why a cancellation refund is computed segment by
      // segment (DECISIONS.md, 2026-09-08 16:09Z).
      endorsementsApplied: snapshot.endorsements.map((endorsement) => ({
        effectiveAt: endorsement.effectiveAt,
        recordedAt: endorsement.recordedAt,
        description: endorsement.description,
        premiumDelta: usd(endorsement.premiumDeltaCents),
        annualPremiumAfter: usd(endorsement.annualPremiumCentsAfter),
      })),
      generatedAt: snapshot.generatedAt,
      whatThisMeans:
        `On ${asOf}, policy ${snapshot.policyNumber} was ${snapshot.status} with an annual premium of ` +
        `${usd(snapshot.annualPremiumCents).formatted} and ${snapshot.endorsements.length} endorsement(s) applied. ` +
        `These are business-time facts: an endorsement recorded later but effective before this date is included, ` +
        `and the money actually charged and collected is in the ledger, not on this answer.`,
    };
  },
};
