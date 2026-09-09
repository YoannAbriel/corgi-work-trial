import { PortalShell } from "@/components/portal-shell";
import { workspaceTasks } from "@/components/what-needs-you";
import { WorkspaceOverview } from "@/components/workspace-overview";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";

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
  // Read once here and given to both the shell (the numbers on the sidebar) and the overview
  // (the "what needs you" block), so the home page counts what is waiting a single time.
  const [tasks, query] = await Promise.all([workspaceTasks(user), searchParams]);

  return (
    <PortalShell user={user} active="home" tasks={tasks}>
      {/* A refused action on another screen sends staff back here with its sentence (review
          finding F-B13-08): the sentence has to be printed, or the refusal is silent. It sits in
          the same .notices block as the broker, customer and inbox homes, so the four line up
          (review finding F-PP-07). */}
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
