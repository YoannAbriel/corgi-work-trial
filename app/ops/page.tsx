import Link from "next/link";
import { redirect } from "next/navigation";
import { Chip } from "@/components/detail-layout";
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
  // you" block, so the home page counts what is waiting a single time.
  const [tasks, query] = await Promise.all([workspaceTasks(user), searchParams]);
  const totalWaiting = tasks.reduce((total, task) => total + task.count, 0);

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
        // One chip: how much is waiting. The signed-in name and the role are already at the
        // bottom of the sidebar, so the band no longer repeats them (Yoann, 2026-09-09).
        meta: <Chip tone={totalWaiting > 0 ? "warn" : "ok"}>{totalWaiting === 0 ? "nothing waiting" : `${totalWaiting} waiting`}</Chip>,
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
