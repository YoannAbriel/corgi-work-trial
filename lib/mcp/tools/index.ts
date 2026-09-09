import { getBrokerStatement } from "./broker-statement";
import { requestClaimPaymentTool } from "./claim-payment";
import { explainAmount } from "./explain-amount";
import { inspectReference } from "./inspect-reference";
import { listMyActivity } from "./my-activity";
import { getPolicyAsOf } from "./policy-as-of";
import { listReconciliationBreaks } from "./reconciliation-breaks";
import { runReconciliationTool } from "./run-reconciliation";
import type { McpTool } from "./tool";

// The whole surface, in one list. Reading order: six tools that only read, one that runs the
// comparison job (which moves no money), and one that can only ask a human for permission.
//
// The brief asks for at least three read tools and one write tool that creates a request in the
// human approval queue rather than moving money. There are six read tools and still exactly one
// write tool: explain_amount, list_my_activity and inspect_reference, added last, read and
// nothing else, and lib/mcp/never-delegated.ts says what is deliberately absent and why.
export const MCP_TOOLS: McpTool[] = [
  getPolicyAsOf,
  getBrokerStatement,
  explainAmount,
  listMyActivity,
  inspectReference,
  listReconciliationBreaks,
  runReconciliationTool,
  requestClaimPaymentTool,
];

export function findTool(name: string): McpTool | null {
  return MCP_TOOLS.find((tool) => tool.name === name) ?? null;
}

export type { McpTool } from "./tool";
