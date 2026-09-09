import { isStaff, policyVisibilityRefusal, type ScopedUser } from "@/lib/mcp/scope";
import { isUuid } from "@/lib/http/path-ids";
import { isCalendarDate } from "@/lib/money/dates";
import {
  explainPolicyFigure,
  FigureNotOnThisPolicy,
  isPolicyFigureKey,
  POLICY_FIGURE_KEYS,
  type PolicyFigureKey,
} from "@/lib/policy/explain-figure";
import { optionalText, requiredText, ToolRefused, usd, type McpTool } from "./tool";

// explain_amount: where one figure on a policy comes from, in the words the screen uses.
//
// It answers with THE SAME EXPLANATION THE FOLD RENDERS: the formula in words, the same formula
// in integer cents, the rounding rule by name, the result, and the journal entries that prove it
// with their ids. Nothing is computed a second time for machines: lib/policy/explain-figure.ts
// composes the same functions the policy page composes (lib/money/explain.ts), so a figure an
// agent quotes here is the figure a person reads on /policies/{id}.
//
// Scope, in TWO gates, because they answer two different questions (review finding F-MCPTOOLS-01).
//
//   WHICH POLICIES are reachable: exactly get_policy_as_of's rule. The owning broker, the covered
//   customer, or staff; a policy this key may not see and a policy that does not exist give the
//   same sentence, so the tool cannot be used to discover which policy numbers exist.
//
//   WHICH FIGURES come back: what this key's user reads on their own screen, which is not the
//   same set for a customer as for the broker who wrote the policy. Seeing the policy is not
//   seeing every figure on it, and the first gate alone was handing a customer key the ledger
//   sums and the broker's commission.
//
// The closed list of figure keys is published twice, because an agent reads one or the other:
// in the description below, and in the tools/list annotation `figureKeys`, which carries what
// each key means.

const FIGURE_KEY_LIST = POLICY_FIGURE_KEYS.map((figure) => figure.key).join(", ");

// WHICH FIGURES A CUSTOMER KEY MAY READ. The customer's own policy screen
// (app/policies/[policyId]/customer-view.tsx) prints the terms in force on a date and the
// endorsement schedule, and deliberately withholds the journal, the ledger sums, the broker's
// commission and the cancellation figures. lib/mcp/scope.ts states the surface rule: an API key
// sees exactly what its user sees on the screens, never more. So the same line is drawn here.
const FIGURE_KEYS_A_CUSTOMER_KEY_READS: PolicyFigureKey[] = [
  "premium_tax",
  "policy_fee",
  "total_charge",
  "endorsement_delta",
];

// The second gate, applied after the visibility one. Staff and the owning broker read every
// figure; anybody else reads the four above and is refused the rest.
//
// The refusal NAMES THE RULE AND NEVER THE FIGURE THE CALLER ASKED FOR: it is written into
// mcp_calls, which can never be updated, deleted or truncated (finding F-B11-02).
function figureVisibilityRefusal(user: ScopedUser, figure: PolicyFigureKey): string | null {
  if (isStaff(user) || user.role === "broker") {
    return null;
  }
  if (FIGURE_KEYS_A_CUSTOMER_KEY_READS.includes(figure)) {
    return null;
  }
  return (
    "this figure is not on the policy screen this key's user reads: a customer sees the terms in force on a date " +
    "(premium_tax, policy_fee, total_charge) and the endorsement delta, and never the journal, the four ledger sums, " +
    "the broker's commission or the cancellation figures"
  );
}

export const explainAmount: McpTool = {
  name: "explain_amount",
  title: "Explain one amount on a policy",
  effect: "read",
  description:
    "Where one figure on a policy comes from: the formula in words, the same formula in integer cents, the rounding rule by name, the result, and the journal entries that prove it. It returns the very explanation the policy screen renders under that figure, computed by the same functions, never a second calculation. " +
    `"figure" must be one of: ${FIGURE_KEY_LIST}. ` +
    "Which policies are reachable is exactly get_policy_as_of's rule. Which figures come back is what this key's " +
    `user reads on their own screen: a customer key gets ${FIGURE_KEYS_A_CUSTOMER_KEY_READS.join(", ")} and is ` +
    "refused the ledger sums, the broker's commission and the cancellation figures, which its own policy screen " +
    "does not show either. Reads only.",
  annotations: {
    // Not part of the protocol's own shape, and deliberately here: a client that reads
    // annotations gets the closed list with the meaning of each key, without a round trip.
    figureKeys: POLICY_FIGURE_KEYS,
    // The subset a customer key may ask for, published for the same reason: an agent should be
    // able to see the line before it walks into it.
    figureKeysACustomerKeyReads: FIGURE_KEYS_A_CUSTOMER_KEY_READS,
  },
  inputSchema: {
    type: "object",
    properties: {
      policy: {
        type: "string",
        description: "The policy number (for example CGP-01274) or the policy id.",
      },
      figure: {
        type: "string",
        description: `Which figure to explain. One of: ${FIGURE_KEY_LIST}.`,
        enum: POLICY_FIGURE_KEYS.map((figure) => figure.key),
      },
      asOf: {
        type: "string",
        description:
          "Business date, YYYY-MM-DD, for the three figures that depend on the terms in force (premium_tax, policy_fee, total_charge). Defaults to today, or to the term start when the term has not begun. Ignored by the other figures, which are events.",
      },
    },
    required: ["policy", "figure"],
    additionalProperties: false,
  },
  async run(args, context) {
    const askedPolicy = requiredText(args, "policy");
    const figure = requiredText(args, "figure");
    if (!isPolicyFigureKey(figure)) {
      // The refusal names the CLOSED LIST and never the value the caller sent: it is written
      // into mcp_calls, which can never be updated, deleted or truncated (finding F-B11-02).
      throw new ToolRefused(`"figure" is not one of the figures this tool explains; it must be one of: ${FIGURE_KEY_LIST}`);
    }
    const asOf = optionalText(args, "asOf");
    if (asOf !== null && !isCalendarDate(asOf)) {
      throw new ToolRefused('"asOf" must be a calendar date written as YYYY-MM-DD, for example 2028-03-01');
    }

    // A policy number or an id: two plain queries rather than one clever one, and the visibility
    // rule applied before anything about the policy is read.
    type PolicyRow = { id: string; policy_number: string; broker_id: string; customer_id: string };
    const found = isUuid(askedPolicy)
      ? await context.database<PolicyRow[]>`
          select id, policy_number, broker_id, customer_id from policies where id = ${askedPolicy}
        `
      : await context.database<PolicyRow[]>`
          select id, policy_number, broker_id, customer_id from policies where policy_number = ${askedPolicy}
        `;
    const policy = found[0];
    const refusal = policyVisibilityRefusal(
      context.user,
      policy ? { brokerId: policy.broker_id, customerId: policy.customer_id } : null,
    );
    if (refusal) {
      throw new ToolRefused(refusal);
    }
    // The figure gate, beside the visibility one: this key may see the policy, which does not
    // settle whether it may see this figure of it (review finding F-MCPTOOLS-01).
    const figureRefusal = figureVisibilityRefusal(context.user, figure);
    if (figureRefusal) {
      throw new ToolRefused(figureRefusal);
    }

    let explained;
    try {
      explained = await explainPolicyFigure({
        policyId: policy.id,
        key: figure,
        asOf,
        today: context.now.toISOString().slice(0, 10),
        database: context.database,
      });
    } catch (error) {
      // "This policy has no cancellation" is an answer, not a failure: it comes back as a
      // refusal the caller can act on. Its sentence is written by us, never by the caller.
      if (error instanceof FigureNotOnThisPolicy) {
        throw new ToolRefused(error.message);
      }
      throw error;
    }

    const explanation = explained.explanation;
    return {
      policyNumber: policy.policy_number,
      figure: explained.key,
      label: explained.label,
      asOf: explained.asOf,
      amount: usd(explained.amountCents),
      // The lines of the fold, in the order the screen prints them: what each one is, the same
      // arithmetic in integer cents, and what it comes to.
      formula: explanation.lines.map((line) => ({
        key: line.key,
        inWords: line.label,
        inCents: line.formula,
        amount: usd(line.cents),
        isTheResult: line.key === explanation.resultKey,
      })),
      rounding: explanation.rounding ?? "nothing is rounded here: this figure is a sum of whole cents",
      note: explanation.note ?? null,
      // The fold's own check, reported rather than hidden: false means the arithmetic does not
      // end on the figure, and the figure is what the ledger holds.
      explanationEndsOnTheFigure: explained.endsOnTheFigure,
      // The endorsement delta replays stored figures, so it carries the other check instead: the
      // endorsement priced again on the server from the inputs stored on its own event.
      recomputedFromStoredInputs: explained.recheck
        ? {
            agrees: explained.recheck.agrees,
            notComputable: explained.recheck.notComputable,
            disagreements: explained.recheck.disagreements.map((disagreement) => ({
              figure: disagreement.figure,
              stored: usd(disagreement.storedCents),
              recomputed: usd(disagreement.recomputedCents),
            })),
          }
        : null,
      provenBy: (explanation.evidence ?? []).map((entry) => ({
        journalEntryId: entry.entryId ?? null,
        entryType: entry.entryType,
        effectiveAt: entry.effectiveAt,
        recordedAt: entry.recordedAt.toISOString(),
        line: entry.detail,
      })),
      evidenceLabel: explanation.evidenceLabel ?? (explanation.evidence?.length ? "Proved by these journal entries." : null),
      whatThisMeans:
        `${explained.label} is ${usd(explained.amountCents).formatted}. The lines above are the explanation the ` +
        `policy screen shows under that figure, produced by the same functions on the server: the arithmetic is in ` +
        `integer cents, the rounding rule is named, and the journal entry ids are the ones a person can open. ` +
        (explained.endsOnTheFigure
          ? "The arithmetic ends on the figure."
          : "WARNING: the arithmetic does not end on the figure. The figure is what the ledger holds; do not report the arithmetic as an explanation of it until a person has looked."),
    };
  },
};
