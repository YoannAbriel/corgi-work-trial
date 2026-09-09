import { sql } from "@/db/client";
import { passwordHashMatches, spendPasswordCheckTime } from "@/lib/auth/password";
import {
  demoPassword,
  passwordMatches,
  secureFlag,
  SESSION_COOKIE_NAME,
  SESSION_LIFETIME_SECONDS,
  sessionSecret,
  signSessionCookie,
} from "@/lib/auth/session";
import { withActivity } from "@/lib/observability/log";

// POST /api/session/login, called by the plain HTML form on /login.
//
// TWO KINDS OF ACCOUNT, one form and one answer (migration 0027):
//   password_hash NULL      a seeded demo account. It signs in with the shared DEMO_PASSWORD,
//                           exactly as it did before that migration;
//   password_hash NOT NULL  a broker created from /ops/brokers?view=new. It signs in with the
//                           one-time password the operator was shown, checked against the scrypt
//                           hash (lib/auth/password.ts).
// Both comparisons are constant time, and the password is never written to a log or stored.
export const POST = withActivity({ route: "/api/session/login", actor: "anonymous" }, handlePost);

async function handlePost(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  const [user] = await sql<{ id: string; role: string; password_hash: string | null }[]>`
    select id, role, password_hash from users where email = ${email}
  `;

  // One message for a wrong email and a wrong password, so the form cannot be used to find out
  // which accounts exist. An 'agent' principal (slice B11) is refused with the same message: it
  // exists to hold an MCP API key, and a browser session is not a thing it may have.
  if (!user || user.role === "agent") {
    // The same sentence is not enough on its own: a branch that returns without hashing anything
    // answers faster than the branch below, and the difference in time says "this account
    // exists" (review finding F-NEWBROKER-03). This spends that time and matches nothing.
    await spendPasswordCheckTime(password);
    return redirectTo(UNKNOWN_EMAIL_OR_PASSWORD);
  }

  // The one place the two kinds of account differ. A user with a hash of their own is NOT opened
  // by the shared demo password: the demo password is not even read on that branch.
  const passwordAccepted =
    user.password_hash === null
      ? passwordMatches(password, demoPassword())
      : await passwordHashMatches(password, user.password_hash);
  if (!passwordAccepted) {
    return redirectTo(UNKNOWN_EMAIL_OR_PASSWORD);
  }

  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
  const cookie = signSessionCookie(user.id, expiresAtEpochSeconds, sessionSecret());

  // Each role lands on its own home: staff on the operations map, a customer on /customer,
  // a broker on /broker. A customer never lands on the broker page that would tell them they
  // are on the wrong screen (finding F-YA-08); every screen still checks the role for itself.
  const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
  const response = redirectTo(isStaff ? "/ops" : user.role === "customer" ? "/customer" : "/broker");
  response.headers.append(
    "set-cookie",
    // HttpOnly: no script can read it. SameSite=Lax: it is not sent from another site's form.
    // Secure everywhere except plain-HTTP local development.
    `${SESSION_COOKIE_NAME}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}${secureFlag()}`,
  );
  return response;
}

// The same sentence for every failure, written once so no branch can say more than another.
const UNKNOWN_EMAIL_OR_PASSWORD = "/login?error=Unknown+email+or+password";

// 303 turns the POST into a GET on the next page, so a refresh does not resubmit the form.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
