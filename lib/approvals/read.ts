import type postgres from "postgres";

// How many money-out requests are still waiting for a human decision.
//
// The approvals screen reads every request with `approvalRequests` in lib/approvals/approvals.ts
// and shows them in full. This file answers the smaller question the sidebar badge asks: how many
// of them nobody has decided yet. It is a count and nothing else, so the badge cannot become a
// second, slower copy of the queue on every page of the workspace.
//
// "Waiting" is the same condition the screen uses to sort undecided requests first: there is no
// row in approval_decisions for the request. A decision is written once (unique index on
// request_id, migration 0008), so the left join can never multiply a request.
export async function countApprovalRequestsWaitingForDecision(
  database: postgres.Sql,
): Promise<number> {
  const [row] = await database<{ waiting: number }[]>`
    select count(*)::int as waiting
      from approval_requests request
      left join approval_decisions decision on decision.request_id = request.id
     where decision.decision is null
  `;
  return row.waiting;
}
