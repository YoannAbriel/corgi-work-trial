import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

// POST /api/session/logout. Clears the cookie by overwriting it with an expired one.
export async function POST() {
  const response = new Response(null, { status: 303, headers: { location: "/login" } });
  response.headers.append("set-cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
