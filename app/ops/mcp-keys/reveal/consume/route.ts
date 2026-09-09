import { currentUser } from "@/lib/auth/current-user";
import { clearedRevealCookie } from "@/lib/mcp/token-reveal";
import { withActivity } from "@/lib/observability/log";

// POST /ops/mcp-keys/reveal/consume: the token has been painted, so the cookie that carried it
// goes now.
//
// WHY IT EXISTS. The screen promises "It is shown once". Without this, a reload inside the 120 s
// Max-Age would show the secret again and make that sentence false. A server component cannot
// clear a cookie (Next.js: "Cookies can only be modified in a Server Action or Route Handler"), so
// the reveal panel calls this route from the browser the moment the token is on screen. The
// Max-Age stays as the backstop for a browser that dies, loses the network, or runs no script at
// all; the Done button clears it as well. Three ways out, one attribute set, built in one place
// (lib/mcp/token-reveal.ts), because a browser only drops a cookie when the deletion matches the
// name, the path and the flags it was set with.
//
// WHY IT SITS UNDER /ops/mcp-keys AND NOT UNDER /api. The cookie's Path is /ops/mcp-keys: it is
// sent to that screen and to nothing else, which is most of what makes it safe. A route under
// /api would never receive it, and could not clear it either.
//
// It answers 204 and no body: there is nothing to say, and nothing about the token may be said.
export const POST = withActivity({ route: "/ops/mcp-keys/reveal/consume", rule: "maker-checker" }, handlePost);

async function handlePost(): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return new Response(null, { status: 401 });
  }
  // The same gate as the screen and as POST /api/mcp-keys (review finding F-INT-01): only staff
  // operations touch access tokens, never the approver who decides money out.
  if (user.role !== "staff_ops") {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": clearedRevealCookie(), "cache-control": "no-store" },
  });
}
