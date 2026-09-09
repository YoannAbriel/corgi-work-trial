import { currentUser } from "@/lib/auth/current-user";
import { createApiKey, expiryInstant, isTokenLifetime, KeyRefused, revokeApiKey } from "@/lib/mcp/keys";
import { TOKEN_REVEAL_COOKIE, TOKEN_REVEAL_SECONDS } from "@/lib/mcp/token-reveal";
import { isUuid } from "@/lib/http/path-ids";
import { withActivity } from "@/lib/observability/log";

// POST /api/mcp-keys: the three staff actions of /ops/mcp-keys (create a token, revoke one,
// dismiss the token this browser was just shown), in one route with a named `action` field, the
// same shape slice B7 uses for claims.
//
// SESSION COOKIES ONLY. `currentUser()` reads the signed cookie; this route never looks at an
// Authorization header, so an MCP key cannot be used to mint another MCP key. That is the first
// entry of lib/mcp/never-delegated.ts, enforced by the absence of any tool for it and by this
// line.
//
// WHERE THE NEW SECRET TRAVELS, AND WHY IT IS A COOKIE. It exists exactly once, in the answer to
// this POST. It cannot go in the redirect URL: a URL lands in the browser history, in the server
// log and in the referrer of the next request (AF-05). It used to be answered as a bare HTML page
// of its own, outside the workspace; Yoann's decision of 2026-09-09 is to show it inside the
// screen, which means the next GET has to be able to read it. So it rides in a cookie:
//
//   * httpOnly, so no script on the page can read it;
//   * Path=/ops/mcp-keys, so it is sent to that one screen and to no other request;
//   * Secure as soon as the deployment is https;
//   * Max-Age=120. That is the trade-off: for at most two minutes the secret is in the browser's
//     cookie jar instead of nowhere at all. Two minutes is long enough to copy a value into an
//     MCP client and short enough that a shared screen left open does not keep it. The "Done"
//     button clears it immediately, and nothing ever stores it server-side: the database still
//     holds only the sha256 and the public prefix.
//
// The redirect that carries it names the PUBLIC PREFIX only (`?created=cmk_1a2b3c4d`), which is
// not a credential, and the screen shows the secret only when the cookie it holds belongs to that
// prefix. The activity log records the route, the status and the redirect's `error=` sentence and
// nothing else (lib/observability/log.ts): no cookie, no body.
export const POST = withActivity({ route: "/api/mcp-keys", rule: "maker-checker" }, handlePost);

async function handlePost(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  // STAFF OPERATIONS ONLY, AND THAT IS MAKER-CHECKER (review finding F-INT-01). A key is a
  // credential that can raise a money-out in somebody else's name, so the person who DECIDES a
  // money-out must not be able to act as the person who REQUESTS one. A staff_approver who could
  // mint a key for the staff_ops user would be both halves of the gate on their own: raise a
  // claim payment through that key, then approve it as themselves. Revocation is refused here
  // too, for the same reason: taking the maker's key away is also a move in that game.
  if (user.role !== "staff_ops") {
    return backToKeys("only staff operations can manage access tokens");
  }

  const form = await request.formData();
  const action = String(form.get("action") ?? "");

  try {
    if (action === "create") {
      const userId = String(form.get("userId") ?? "");
      if (!isUuid(userId)) {
        return backToKeys("that is not a user id");
      }
      const principalKind = String(form.get("principalKind") ?? "");
      if (principalKind !== "human" && principalKind !== "agent") {
        return backToKeys('"used by" must be a person or an agent');
      }
      // The five lengths the form offers, checked against the same list the form was drawn from
      // (lib/mcp/key-format.ts). Anything else is refused rather than quietly turned into "never".
      const expiresIn = String(form.get("expiresIn") ?? "");
      if (!isTokenLifetime(expiresIn)) {
        return backToKeys("that is not one of the expirations this screen offers");
      }
      const created = await createApiKey({
        userId,
        label: String(form.get("label") ?? ""),
        principalKind,
        createdByUserId: user.id,
        expiresAt: expiryInstant(expiresIn, new Date()),
      });
      return tokenShownOnce(created.presentedKey, created.keyPrefix);
    }

    // The "Done" button of the drawer that showed the token: the cookie goes, the screen reloads
    // without it, and the secret exists nowhere any more.
    if (action === "dismiss") {
      const response = redirectTo("/ops/mcp-keys");
      response.headers.append("set-cookie", `${TOKEN_REVEAL_COOKIE}=; Path=/ops/mcp-keys; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`);
      return response;
    }

    if (action === "revoke") {
      const keyId = String(form.get("keyId") ?? "");
      if (!isUuid(keyId)) {
        return backToKeys("that is not a key id");
      }
      await revokeApiKey({ keyId, revokedByUserId: user.id, reason: `revoked by ${user.displayName}` });
      return redirectTo("/ops/mcp-keys?revoked=1");
    }

    return backToKeys(`unknown action "${action}"`);
  } catch (error) {
    if (error instanceof KeyRefused) {
      return backToKeys(error.message);
    }
    throw error;
  }
}

// The answer to a creation: back to the screen, with the public prefix in the URL and the secret
// in the short-lived cookie described at the top of this file. No-store, so no proxy and no
// browser cache keeps the Set-Cookie header of this answer.
function tokenShownOnce(presentedKey: string, keyPrefix: string): Response {
  const response = redirectTo(`/ops/mcp-keys?created=${encodeURIComponent(keyPrefix)}`);
  response.headers.append(
    "set-cookie",
    `${TOKEN_REVEAL_COOKIE}=${presentedKey}; Path=/ops/mcp-keys; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_REVEAL_SECONDS}${secureFlag()}`,
  );
  response.headers.set("cache-control", "no-store, no-cache, must-revalidate");
  return response;
}

// Secure everywhere except plain-HTTP local development, the same rule the session cookie of
// app/api/session/login/route.ts follows.
function secureFlag(): string {
  return process.env.APP_BASE_URL?.startsWith("https://") ? "; Secure" : "";
}

function backToKeys(message: string): Response {
  return redirectTo(`/ops/mcp-keys?error=${encodeURIComponent(message)}`);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
