import { policyVisibilityRefusal } from "@/lib/mcp/scope";
import { isUuid } from "@/lib/http/path-ids";
import { isCalendarDate } from "@/lib/money/dates";
import {
  explainPolicyFigure,
  FigureNotOnThisPolicy,
  isPolicyFigureKey,
  POLICY_FIGURE_KEYS,
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
// Scope: exactly get_policy_as_of's. The owning broker, the covered customer, or staff; a policy
// this key may not see and a policy that does not exist give the same sentence, so the tool
// cannot be used to discover which policy numbers exist.
//
// The closed list of figure keys is published twice, because an agent reads one or the other:
// in the description below, and in the tools/list annotation `figureKeys`, which carries what
// each key means.

const FIGURE_KEY_LIST = POLICY_FIGURE_KEYS.map((figure) => figure.key).join(", ");

export const explainAmount: McpTool = {
  name: "explain_amount",
  title: "Explain one amount on a policy",
  effect: "read",
  description:
    "Where one figure on a policy comes from: the formula in words, the same formula in integer cents, the rounding rule by name, the result, and the journal entries that prove it. It returns the very explanation the policy screen renders under that figure, computed by the same functions, never a second calculation. " +
    `"figure" must be one of: ${FIGURE_KEY_LIST}. ` +
    "Scoped to what this API key's user may see, exactly like get_policy_as_of. Reads only.",
  annotations: {
    // Not part of the protocol's own shape, and deliberately here: a client that reads
    // annotations gets the closed list with the meaning of each key, without a round trip.
    figureKeys: POLICY_FIGURE_KEYS,
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
