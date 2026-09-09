import { spawn } from "node:child_process";

// The dev server that `npm run check:mcp` talks to: the application, on port 3800, reading and
// writing the DISPOSABLE database instead of the development one.
//
//   npm run dev:test-db      in one terminal, then
//   npm run check:mcp        in another
//
// WHY A SCRIPT RATHER THAN A LINE TO COPY. The line it replaces was
// `DATABASE_URL_APP="$DATABASE_URL_TEST_APP" npm run dev -- -p 3800`, which only works in a
// shell that has already exported the variable, and which puts a connection string (with its
// password) into the terminal's history the moment somebody types it out in full. This reads
// .env.local itself, hands the value to the child process, and NEVER PRINTS IT: not the test
// URL, not the development one, not any part of either.
//
// Next.js does not overwrite a variable that is already in the environment, so the value set
// here wins over the DATABASE_URL_APP in .env.local, exactly as the command line did.

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment, like every other script here
}

const testAppUrl = process.env.DATABASE_URL_TEST_APP;
if (!testAppUrl) {
  console.error("DATABASE_URL_TEST_APP is not set: it is the runtime role's connection to the disposable database");
  process.exit(1);
}

// 3800 is the port the MCP check expects (scripts/check-mcp.ts, MCP_BASE_URL).
const port = process.env.PORT ?? "3800";
console.log(`starting the application on port ${port} against the disposable database (nothing about the connection is printed)`);

// "next" and not a path to it: npm run puts node_modules/.bin on PATH, which is how every other
// script here finds its binary, and it keeps working from a worktree that shares the checkout's
// installed modules.
const server = spawn("next", ["dev", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL_APP: testAppUrl },
});

// Ctrl+C reaches this process first; the child is asked to stop and this one waits for it, so no
// server is left holding the port after the check.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 0));
