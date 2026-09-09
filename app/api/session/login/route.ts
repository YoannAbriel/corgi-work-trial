import { sql } from "@/db/client";
import {
  demoPassword,
  passwordMatches,
  SESSION_COOKIE_NAME,
  SESSION_LIFETIME_SECONDS,
  sessionSecret,
  signSessionCookie,
} from "@/lib/auth/session";

// POST /api/session/login, called by the plain HTML form on /login.
// Every demo account shares DEMO_PASSWORD; the password is compared in constant time and is
// never written to a log or to the database.
export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  const [user] = await sql<{ id: string; role: string }[]>`select id, role from users where email = ${email}`;

  // One message for a wrong email and a wrong password, so the form cannot be used to find out
  // which accounts exist. An 'agent' principal (slice B11) is refused with the same message: it
  // exists to hold an MCP API key, and a browser session is not a thing it may have.
  if (!user || user.role === "agent" || !passwordMatches(password, demoPassword())) {
    return redirectTo("/login?error=Unknown+email+or+password");
  }

  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
  const cookie = signSessionCookie(user.id, expiresAtEpochSeconds, sessionSecret());

  // Staff land on the operations map, everybody else on the broker journey (customers find
  // their approvals from there; the screens ask the role question again for themselves).
  const isStaff = user.role === "staff_ops" || user.role === "staff_approver";
  // Each role lands on its own home: a customer on /customer, never on the broker page that
  // would tell them they are on the wrong screen (recheck finding F-YA-08).
  const response = redirectTo(isStaff ? "/ops" : user.role === "customer" ? "/customer" : "/broker");
  response.headers.append(
    "set-cookie",
    // HttpOnly: no script can read it. SameSite=Lax: it is not sent from another site's form.
    // Secure everywhere except plain-HTTP local development.
    `${SESSION_COOKIE_NAME}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}${secureFlag()}`,
  );
  return response;
}

function secureFlag(): string {
  return process.env.APP_BASE_URL?.startsWith("https://") ? "; Secure" : "";
}

// 303 turns the POST into a GET on the next page, so a refresh does not resubmit the form.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
