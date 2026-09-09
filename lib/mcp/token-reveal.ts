// The cookie that carries a brand new token from the POST that created it to the screen that
// shows it, and nothing else. It lives in a file of its own because three places must name it and
// give it EXACTLY the same attributes, and a Next.js route file may only export HTTP handlers:
//
//   app/api/mcp-keys/route.ts                     sets it (create) and clears it (dismiss);
//   app/ops/mcp-keys/page.tsx                     reads it;
//   app/ops/mcp-keys/reveal/consume/route.ts      clears it as soon as the token has been painted.
//
// A browser only drops a cookie when the deletion matches the name, the path and the flags it was
// set with, so the two strings below are built by the same functions and can never drift apart.
//
// WHY A COOKIE AND NOT THE URL: the secret exists exactly once, in the answer to that POST. A URL
// lands in the browser history, in the server log and in the referrer of the next request
// (AF-05); an httpOnly cookie scoped to this one path does not, and no script on the page can
// read it either. The full reasoning is at the top of app/api/mcp-keys/route.ts.
export const TOKEN_REVEAL_COOKIE = "mcp_token_reveal";

// The backstop, not the plan. The plan is the consume call the reveal panel makes as soon as the
// token is on screen (components under app/ops/mcp-keys/); this ceiling is what happens instead
// when the browser is closed, loses the network or has scripts turned off, and it is short enough
// that a shared screen left open does not keep the secret.
export const TOKEN_REVEAL_SECONDS = 120;

// Secure in production and nowhere else. It reads NODE_ENV, which the framework sets itself, and
// not APP_BASE_URL, which is a variable a deployment can forget to fill: the session cookie of
// app/api/session/login/route.ts reads that variable, and this cookie carries a credential valid
// for the whole MCP surface, so it takes the flag that cannot be left out by accident.
function attributes(): string {
  return `Path=/ops/mcp-keys; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

// SameSite=Strict: no other site can cause a request that carries it, not even a top-level link.
// The redirect that follows the creation is this site navigating to itself, which Strict allows.
export function revealCookie(presentedKey: string): string {
  return `${TOKEN_REVEAL_COOKIE}=${presentedKey}; ${attributes()}; Max-Age=${TOKEN_REVEAL_SECONDS}`;
}

export function clearedRevealCookie(): string {
  return `${TOKEN_REVEAL_COOKIE}=; ${attributes()}; Max-Age=0`;
}
