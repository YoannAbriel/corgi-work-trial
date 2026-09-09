// The cookie that carries a brand new token from the POST that created it to the screen that
// shows it, and nothing else. Two constants, in a file of their own, because the route that sets
// the cookie and the page that reads it must name it identically, and a Next.js route file may
// only export its HTTP handlers.
//
// WHY A COOKIE AND NOT THE URL: the secret exists exactly once, in the answer to that POST. A URL
// lands in the browser history, in the server log and in the referrer of the next request
// (AF-05); an httpOnly cookie scoped to this one path does not, and no script on the page can
// read it either. The full reasoning is at the top of app/api/mcp-keys/route.ts.
export const TOKEN_REVEAL_COOKIE = "mcp_token_reveal";

// The trade-off: for at most two minutes the secret sits in the browser's cookie jar instead of
// nowhere at all. Long enough to copy it into an MCP client, short enough that a shared screen
// left open does not keep it. The "Done" button of the drawer clears it before that.
export const TOKEN_REVEAL_SECONDS = 120;
