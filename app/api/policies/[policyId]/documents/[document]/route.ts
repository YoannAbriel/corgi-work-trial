import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { documentEventsFromRows, type PolicyEventRowForDocuments } from "@/lib/documents/from-database";
import { foldPolicyEvents } from "@/lib/documents/policy-as-of";
import { renderDeclarationsPdf, renderEndorsementSchedulePdf } from "@/lib/documents/render";
import { isCalendarDate } from "@/lib/money/dates";
import { badPathIdResponse } from "@/lib/http/path-ids";

// GET /api/policies/{policyId}/documents/{declarations|endorsement-schedule}?asOf=YYYY-MM-DD
//
// The policy as it stood on a business date, as a real PDF generated from its immutable events:
// only the events effective on or before `asOf` count, events undone by a correction are
// skipped, and between two endorsements the declarations page shows the premium and limits in
// force on that date (lib/documents/policy-as-of.ts). Who may read: the owning broker, the
// policy's customer, and staff. The names printed come from the seeded synthetic parties.
export async function GET(request: Request, context: { params: Promise<{ policyId: string; document: string }> }) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "sign in first" }, { status: 401 });
  }
  const { policyId, document } = await context.params;
  const malformedId = badPathIdResponse({ policy: policyId }); // a malformed id answers 400, not 500 (F-B7-07)
  if (malformedId) {
    return malformedId;
  }
  if (document !== "declarations" && document !== "endorsement-schedule") {
    return Response.json({ error: "unknown document; use declarations or endorsement-schedule" }, { status: 404 });
  }

  const asOf = new URL(request.url).searchParams.get("asOf") ?? new Date().toISOString().slice(0, 10);
  if (!isCalendarDate(asOf)) {
    return Response.json({ error: `asOf must be a calendar date, got "${asOf}"` }, { status: 400 });
  }

  const [policy] = await sql<
    { id: string; policy_number: string; broker_id: string; customer_id: string; state_code: string; broker_name: string; customer_name: string; customer_email: string }[]
  >`
    select policy.id, policy.policy_number, policy.broker_id, policy.customer_id, policy.state_code,
           broker.name as broker_name, customer.name as customer_name, customer.email as customer_email
      from policies policy
      join brokers broker on broker.id = policy.broker_id
      join customers customer on customer.id = policy.customer_id
     where policy.id = ${policyId}
  `;
  if (!policy) {
    return Response.json({ error: "no such policy" }, { status: 404 });
  }
  const isOwningBroker = user.role === "broker" && user.brokerId === policy.broker_id;
  const isOwningCustomer = user.role === "customer" && user.customerId === policy.customer_id;
  const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
  if (!isOwningBroker && !isOwningCustomer && !isStaff) {
    return Response.json({ error: "this policy is not yours to read" }, { status: 403 });
  }

  const rows = await sql<PolicyEventRowForDocuments[]>`
    select id, event_type, to_char(effective_at, 'YYYY-MM-DD') as effective_at, recorded_at, supersedes_event_id, payload
      from policy_events
     where policy_id = ${policyId}
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
    snapshot = foldPolicyEvents(events, asOf, new Date().toISOString());
  } catch (error) {
    // A policy not yet in force on that date (or voided) has no document for it: the reason is
    // returned as text, never as an empty or invented PDF.
    return Response.json({ error: error instanceof Error ? error.message : "the policy cannot be reconstructed on that date" }, { status: 404 });
  }

  const pdf = document === "declarations" ? await renderDeclarationsPdf(snapshot) : await renderEndorsementSchedulePdf(snapshot);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${document}-${policy.policy_number}-as-of-${asOf}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
