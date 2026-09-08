import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { renderStatementPdf } from "@/lib/statements/pdf";
import { statementRun } from "@/lib/statements/read";
import { badPathIdResponse } from "@/lib/http/path-ids";

// GET /api/statements/{runId}/pdf: the statement as a PDF file.
//
// The same access rule as the page it is downloaded from, asked again here: staff see every
// statement, a broker sees only the statements of the broker their session is attached to. A
// route that renders a document is a door like any other, so it asks the question itself instead
// of assuming the visitor came through the page.
//
// The file is built from the stored run alone (lib/statements/pdf.tsx). Nothing is recomputed, so
// downloading revision 1 next year produces the document that was published, not a fresh view of
// a ledger that has moved on.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await currentUser();
  if (!user) {
    return new Response("sign in first", { status: 401 });
  }
  const { runId } = await context.params;
  const malformedId = badPathIdResponse({ run: runId }); // a malformed id answers 400, not 500 (F-B7-07)
  if (malformedId) {
    return malformedId;
  }
  // A malformed id is a wrong address, not a server error: it must not reach the uuid column.
  if (!UUID.test(runId)) {
    return new Response("no such statement", { status: 404 });
  }

  const statement = await statementRun(sql, runId);
  if (!statement) {
    return new Response("no such statement", { status: 404 });
  }
  const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
  const isOwningBroker = user.role === "broker" && user.brokerId === statement.run.brokerId;
  if (!isStaff && !isOwningBroker) {
    // 404 rather than 403: an outsider learns nothing about which statements exist.
    return new Response("no such statement", { status: 404 });
  }

  const pdf = await renderStatementPdf(statement);
  const fileName = `statement-${statement.run.statementMonth}-revision-${statement.run.revision}.pdf`;
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      // `inline` so the browser shows it; the file name still applies when it is saved.
      "content-disposition": `inline; filename="${fileName}"`,
      // A run is immutable, but the access rules are per user, so it is never cached publicly.
      "cache-control": "private, no-store",
    },
  });
}
