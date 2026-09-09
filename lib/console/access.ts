import type { UserRole } from "@/lib/auth/current-user";

// Who may open the operations console, as a pure function of the role.
//
// It is a file of its own, importing nothing but a type, for one reason: lib/console/guard.ts
// imports `redirect` from next/navigation and, through currentUser, the application connection
// pool. This rule deserves to be provable by a script that has neither (scripts/check-console.ts),
// which is the same reason lib/mcp/key-format.ts was split out of lib/mcp/keys.ts.
//
// 'allow' means the page renders. Anything else is the path the person is sent to instead.
//
//   staff_ops, staff_approver  the two staff roles: allowed
//   broker                     their own screen, which is scoped to their own policies
//   customer                   their own screen
//   agent                      cannot happen, because an agent principal exists only behind an
//                              MCP API key and is refused at the login form, so it never holds a
//                              session. It is named here anyway: a rule that works only by
//                              omission is a rule waiting to be broken by the next role added.
//   nobody signed in           /login
//
// THE CONSOLE IS NOT SCOPED. Every reader behind it reads across every broker and every
// customer, and none of them takes a user. That is deliberate and it is exactly why this rule
// has no third answer: there is no version of these screens that a broker could safely be shown.
export function consoleAccessFor(role: UserRole | null): "allow" | string {
  if (role === null) return "/login";
  if (role === "staff_ops" || role === "staff_approver") return "allow";
  if (role === "customer") return "/customer";
  return "/broker";
}
