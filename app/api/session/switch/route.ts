import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { isDemoAccountEmail } from "@/lib/auth/demo-accounts";
import { SESSION_COOKIE_NAME, SESSION_LIFETIME_SECONDS, sessionSecret, signSessionCookie } from "@/lib/auth/session";
import { withActivity } from "@/lib/observability/log";

// POST /api/session/switch, called by the account menu at the bottom of the sidebar.
//
// A signed-in demo user becomes another DEMO account without typing the shared password again
// (Yoann, 2026-09-09). Three gates, in this order, and the route answers the same 303 for each:
//   1. there must be a valid session already (nobody signs in through here);
//   2. the target email must be on the closed list in lib/auth/demo-accounts.ts;
//   3. the target must exist and must not be an 'agent' principal, exactly as /api/session/login.
// The new cookie is signed the same way login signs it, so every screen keeps checking the
// role for itself. The activity log keeps the row like any sign in (rule "sign in").
export const POST = withActivity({ route: "/api/session/switch", rule: "sign in" }, handlePost);

async function handlePost(request: Request) {
  const user = await currentUser();
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+first");
  }
  const home = homeOf(user.role);

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!isDemoAccountEmail(email)) {
    return redirectTo(`${home}?error=${encodeURIComponent("that is not one of the demo accounts")}`);
  }

  const [target] = await sql<{ id: string; role: string }[]>`select id, role from users where email = ${email}`;
  if (!target || target.role === "agent") {
    return redirectTo(`${home}?error=${encodeURIComponent("that demo account does not exist on this database")}`);
  }

  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
  const cookie = signSessionCookie(target.id, expiresAtEpochSeconds, sessionSecret());
  const response = redirectTo(homeOf(target.role));
  response.headers.append(
    "set-cookie",
    // The same flags as /api/session/login: HttpOnly, SameSite=Lax, Secure on https.
    `${SESSION_COOKIE_NAME}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}${secureFlag()}`,
  );
  return response;
}

// Each role lands on its own home, the same table as /api/session/login.
function homeOf(role: string): string {
  if (role === "staff_ops" || role === "staff_approver") return "/ops";
  if (role === "customer") return "/customer";
  return "/broker";
}

function secureFlag(): string {
  return process.env.APP_BASE_URL?.startsWith("https://") ? "; Secure" : "";
}

// 303 turns the POST into a GET on the next page, so a refresh does not resubmit the form.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
