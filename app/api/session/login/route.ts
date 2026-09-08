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

  const [user] = await sql<{ id: string }[]>`select id from users where email = ${email}`;

  // One message for a wrong email and a wrong password, so the form cannot be used to find out
  // which accounts exist.
  if (!user || !passwordMatches(password, demoPassword())) {
    return redirectTo("/login?error=Unknown+email+or+password");
  }

  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
  const cookie = signSessionCookie(user.id, expiresAtEpochSeconds, sessionSecret());

  const response = redirectTo("/broker");
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
