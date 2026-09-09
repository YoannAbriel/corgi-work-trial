import Link from "next/link";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { workspaceTasks } from "@/components/what-needs-you";
import { WorkspaceOverview } from "@/components/workspace-overview";
import { currentUser } from "@/lib/auth/current-user";
import { toastsFromQuery } from "@/lib/ui/views";

// /ops: where a staff member lands after signing in. Nothing is computed here; it is the map
// of the operations screens, each of which asks the role question again for itself.
export default async function OpsHomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  const isApprover = user.role === "staff_approver";
  // Read once here and given to the shell (the sidebar counts), the tiles and the "what needs
  // you" block, so the home page counts what is waiting a single time. The band adds no total of
  // its own: the sidebar badges are the count (Yoann, 2026-09-09).
  const [tasks, query] = await Promise.all([workspaceTasks(user), searchParams]);

  // A refused action on another screen sends staff back here with its sentence (review finding
  // F-B13-08): the sentence has to be printed, or the refusal is silent.
  const toasts = toastsFromQuery(query, { error: { tone: "error", title: "Refused" } });

  return (
    <PortalShell
      user={user}
      active="home"
      tasks={tasks}
      toasts={toasts}
      band={{
        title: "Overview",
        // Nothing but the title (Yoann, 2026-09-09): the role sits at the bottom of the sidebar,
        // and how much is waiting is in the sidebar badges and in the tiles below.
        actions: (
          <>
            <Link href="/inbox" prefetch={false} className="button-link secondary">
              Inbox
            </Link>
            <Link href="/ops/console" prefetch={false} className="button-link">
              Open the console
            </Link>
          </>
        ),
      }}
    >
      {query.error ? (
        <div className="notices">
          <p className="error" role="alert">
            {query.error}
          </p>
        </div>
      ) : null}
      <WorkspaceOverview isApprover={isApprover} tasks={tasks} />
    </PortalShell>
  );
}
