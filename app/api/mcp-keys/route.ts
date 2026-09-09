import { currentUser } from "@/lib/auth/current-user";
import { createApiKey, expiryInstant, isTokenLifetime, KeyRefused, revokeApiKey } from "@/lib/mcp/keys";
import { clearedRevealCookie, revealCookie } from "@/lib/mcp/token-reveal";
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
//   * SameSite=Strict, so no other site can cause a request that carries it, not even a
//     top-level link. The redirect below is this site navigating to itself, which Strict allows;
//   * Secure in production, decided by NODE_ENV rather than by APP_BASE_URL: `next build` and
//     `next start` set it, Vercel sets it, and a deployment that forgot to fill an environment
//     variable would silently lose the flag. Plain-HTTP local development is the only case where
//     it is absent, and there is no https there to send it over;
//   * Max-Age=120, and that is the BACKSTOP, not the plan. The plan is the consume step: the
//     reveal panel asks POST /ops/mcp-keys/reveal/consume to clear the cookie as soon as the
//     token is painted, so the exposure is one render, which is what the screen's own words
//     promise. The ceiling is what happens instead when the browser is closed, loses the network
//     or runs no script. The "Done" button clears it as well, and nothing is ever stored
//     server-side: the database still holds only the sha256 and the public prefix.
//
// WHY THE SCREEN ITSELF CANNOT CLEAR IT. A server component may read cookies and may not write
// them: calling `cookieStore.delete(...)` from app/ops/mcp-keys/page.tsx raises, word for word,
// "Cookies can only be modified in a Server Action or Route Handler. Read more:
// https://nextjs.org/docs/app/api-reference/functions/cookies#options" (Next.js 16.3.4, measured
// on 2026-09-09). Only a route handler can send Set-Cookie, hence the consume route above, called
// from the one small client component of this screen. Nothing else on the deployed answer keeps
// the token either: that page is answered with
// `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` (measured on a
// production build the same day).
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
      // THE LABEL IS BOUNDED HERE (review finding F-TK-01). mcp_api_keys is append-only: a row
      // carrying five thousand characters of pasted nonsense can never be edited or deleted, and
      // the screen prints that label on one line for ever. 120 characters is a name for a laptop
      // or a client, which is what the field is for. The matching CHECK constraint on the column
      // is a week-two line: adding one tonight would mean a migration on the trial database on
      // the evening of a freeze, and this route is the only path that writes a label from a
      // browser (scripts/create-mcp-key.ts is a local operator tool).
      const label = String(form.get("label") ?? "").trim();
      if (label.length === 0 || label.length > 120) {
        return backToKeys("a label is one to 120 characters");
      }
      const created = await createApiKey({
        userId,
        label,
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
      // Same name, same path and same flags as the cookie it replaces, with Max-Age=0: a browser
      // only drops a cookie when the deletion matches the attributes it was set with, which is
      // why both strings are built in lib/mcp/token-reveal.ts and never typed out twice.
      response.headers.append("set-cookie", clearedRevealCookie());
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

    // The sentence never quotes what the caller sent (review finding F-TK-05): it would put an
    // unbounded string into a Location header, a browser history entry and, through the toast,
    // onto the screen. There are three actions and a reader of this file can see all three.
    return backToKeys("unknown action");
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
  response.headers.append("set-cookie", revealCookie(presentedKey));
  response.headers.set("cache-control", "no-store, no-cache, must-revalidate");
  return response;
}

function backToKeys(message: string): Response {
  return redirectTo(`/ops/mcp-keys?error=${encodeURIComponent(message)}`);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
