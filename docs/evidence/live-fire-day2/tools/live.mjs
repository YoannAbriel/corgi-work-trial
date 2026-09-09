// Read-only helper for the live-fire session.
//   node live.mjs login <email>              POST /api/session/login once, keep the cookie in ./cookies/<email>
//   node live.mjs get <email> <path> <out>   GET <path> with that cookie, write the body to <out>
// The demo password is read from .env.local through process.loadEnvFile and never printed.
// Nothing here posts anything except the login form. No money route is ever called.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const REPO = "/Users/yoannabriel/dev/corgi-work-trial";
const BASE = "https://corgi-work-trial-iota.vercel.app";
const HERE = dirname(new URL(import.meta.url).pathname);
const COOKIE_DIR = join(HERE, "cookies");
mkdirSync(COOKIE_DIR, { recursive: true });

const [command, email, path, out] = process.argv.slice(2);

function cookieFile(who) {
  return join(COOKIE_DIR, who.replace(/[^a-z0-9@.]/gi, "_"));
}

async function login(who) {
  process.loadEnvFile(join(REPO, ".env.local"));
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error("DEMO_PASSWORD absent from .env.local");
  const body = new URLSearchParams({ email: who, password });
  const response = await fetch(`${BASE}/api/session/login`, { method: "POST", body, redirect: "manual" });
  const location = response.headers.get("location");
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/corgi_session=([^;]+)/);
  if (response.status !== 303 || !match || location === "/login?error=Unknown+email+or+password") {
    throw new Error(`login refused for ${who}: status ${response.status}, location ${location}`);
  }
  writeFileSync(cookieFile(who), `corgi_session=${match[1]}`, { mode: 0o600 });
  console.log(`login ok for ${who}: ${response.status} -> ${location}`);
}

async function get(who, requestPath, outFile) {
  const file = cookieFile(who);
  const cookie = who === "anonymous" ? "" : existsSync(file) ? readFileSync(file, "utf8") : null;
  if (cookie === null) throw new Error(`no cookie for ${who}, run login first`);
  const response = await fetch(`${BASE}${requestPath}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, bytes);
  }
  const location = response.headers.get("location");
  console.log(
    `GET ${requestPath} as ${who}: ${response.status} ${response.headers.get("content-type") ?? ""} ${bytes.length} bytes` +
      (location ? ` -> ${location}` : "") +
      (outFile ? ` -> ${outFile}` : ""),
  );
}

if (command === "login") await login(email);
else if (command === "get") await get(email, path, out);
else {
  console.error("usage: login <email> | get <email> <path> [out]");
  process.exit(2);
}
