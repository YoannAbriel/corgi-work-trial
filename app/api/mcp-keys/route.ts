import { currentUser } from "@/lib/auth/current-user";
import { createApiKey, KeyRefused, revokeApiKey } from "@/lib/mcp/keys";
import { isUuid } from "@/lib/http/path-ids";

// POST /api/mcp-keys: the two staff actions of /ops/mcp-keys, in one route with a named
// `action` field, the same shape slice B7 uses for claims.
//
// SESSION COOKIES ONLY. `currentUser()` reads the signed cookie; this route never looks at an
// Authorization header, so an MCP key cannot be used to mint another MCP key. That is the first
// entry of lib/mcp/never-delegated.ts, enforced by the absence of any tool for it and by this
// line.
//
// WHY CREATING ANSWERS WITH A PAGE AND NOT A REDIRECT: the secret exists exactly once, in this
// answer. A redirect would put it in a URL, and a URL lands in the browser history, in the
// server log and in the referrer of the next request (AF-05). So the answer is a small page
// that shows it, and nothing else in the system can ever read it back.
export async function POST(request: Request): Promise<Response> {
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
    return backToKeys("only staff operations can manage MCP API keys");
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
        return backToKeys('"who holds it" must be a person or an agent');
      }
      const created = await createApiKey({
        userId,
        label: String(form.get("label") ?? ""),
        principalKind,
        createdByUserId: user.id,
      });
      return secretShownOncePage(created.presentedKey, created.keyPrefix);
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

// The only page in this application that ever shows a secret. It is not stored anywhere, it is
// not in the URL, and reloading gives nothing: the answer to a POST is not addressable.
function secretShownOncePage(presentedKey: string, keyPrefix: string): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>MCP API key created</title>
<style>
 body { font: 16px/1.5 system-ui, sans-serif; max-width: 760px; margin: 0 auto; padding: 32px 24px; color: #1c1c1c; }
 code { background: #f2f2f2; padding: 2px 6px; }
 pre { background: #f2f2f2; padding: 16px; overflow-x: auto; word-break: break-all; white-space: pre-wrap; }
 .warn { color: #8a1f1f; font-weight: 600; }
</style></head>
<body>
<h1>Key ${escapeHtml(keyPrefix)} created</h1>
<p class="warn">This is the only time this secret is shown. It is not stored: the database holds its sha256 and its
public prefix, so nobody, including this application, can read it back. Lost means create another key and revoke this
one.</p>
<pre>${escapeHtml(presentedKey)}</pre>
<p>Use it as a bearer token against <code>POST /api/mcp</code>:</p>
<pre>curl -s http://localhost:3000/api/mcp \\
  -H "Authorization: Bearer &lt;the key above&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'</pre>
<p>Do not paste it into a document, a ticket or a commit. <a href="/ops/mcp-keys">Back to the keys</a>.</p>
</body></html>`;
  return new Response(html, {
    status: 200,
    // no-store, and nothing here is cacheable by a proxy: the body is a credential.
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, no-cache, must-revalidate" },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function backToKeys(message: string): Response {
  return redirectTo(`/ops/mcp-keys?error=${encodeURIComponent(message)}`);
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
