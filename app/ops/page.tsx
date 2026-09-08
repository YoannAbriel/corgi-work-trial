import { PortalShell } from "@/components/portal-shell";
import { workspaceTasks } from "@/components/what-needs-you";
import { WorkspaceOverview } from "@/components/workspace-overview";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";

// /ops: where a staff member lands after signing in. Nothing is computed here; it is the map
// of the operations screens, each of which asks the role question again for itself.
export default async function OpsHomePage() {
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
  const tasks = await workspaceTasks(user);

  return (
    <PortalShell user={user} active="home" tasks={tasks}>
      <WorkspaceOverview isApprover={isApprover} tasks={tasks} />
    </PortalShell>
  );
}
