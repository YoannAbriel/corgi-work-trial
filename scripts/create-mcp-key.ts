import postgres from "postgres";

// Creates one MCP API key and prints its secret ONCE.
//
//   npm run create-mcp-key -- --email=ops@example.com --label="Claude Desktop" --kind=agent
//   npm run create-mcp-key -- --email=broker@example.com --label="broker demo" --kind=human --database=test
//
// WHICH CONNECTION, AND WHY THE RUNTIME ONE. This script uses DATABASE_URL_APP (the app_runtime
// role), not the owner connection. Creating a key is exactly what the staff screen does, with
// exactly the privileges the deployed application has: INSERT on mcp_api_keys and nothing else.
// A helper that needed more than the application itself would be a helper that could do more
// than the application itself, and there is no reason for that here. The owner connection stays
// for migrations and the seed.
//
// THE SECRET IS PRINTED, ONCE, TO STANDARD OUTPUT. It is never stored (only its sha256 is),
// never written to a file by this script, and never committed (AF-05). Whoever runs it puts the
// value straight into the MCP client's configuration or an ignored environment file, and does
// not paste it anywhere else. Losing it means creating another key and revoking this one.
//
// The seed deliberately creates no key: a seed that printed a secret would leave it in every
// terminal log of every environment it ever ran in.

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

const useTestDatabase = process.argv.includes("--database=test");
const runtimeUrl = useTestDatabase ? process.env.DATABASE_URL_TEST_APP : process.env.DATABASE_URL_APP;
if (!runtimeUrl) {
  console.error(
    useTestDatabase ? "DATABASE_URL_TEST_APP is not set" : "DATABASE_URL_APP is not set (the app_runtime connection)",
  );
  process.exit(1);
}

const email = readOption("email");
const label = readOption("label");
const kind = readOption("kind") ?? "agent";
if (!email || !label) {
  console.error(
    'usage: npm run create-mcp-key -- --email=<demo user email> --label="<what this key is>" [--kind=agent|human] [--database=test]',
  );
  process.exit(1);
}
if (kind !== "agent" && kind !== "human") {
  console.error(`--kind must be "agent" or "human", got "${kind}"`);
  process.exit(1);
}

const runtime = postgres(runtimeUrl, { max: 1, prepare: false });

async function main() {
  // Imported here rather than at the top: the module opens the application connection pool as
  // soon as it is loaded, and .env.local has to be read first.
  const { createApiKey } = await import("@/lib/mcp/keys");

  const [user] = await runtime<{ id: string; display_name: string; role: string }[]>`
    select id, display_name, role from users where email = ${email!.toLowerCase()}
  `;
  if (!user) {
    console.error(`no user with the email ${email}. Run npm run seed first, or pass one of the demo accounts.`);
    process.exit(1);
  }

  const created = await createApiKey(
    { userId: user.id, label: label!, principalKind: kind as "agent" | "human", createdByUserId: null },
    runtime,
  );

  console.log("");
  console.log(`key created for   ${user.display_name} (${user.role}), ${email}`);
  console.log(`label             ${label}`);
  console.log(`holder            ${kind === "agent" ? "an autonomous agent" : "a person using an MCP client"}`);
  console.log(`prefix            ${created.keyPrefix}    (public, shown on /ops/mcp-keys)`);
  console.log("");
  console.log("THE SECRET, SHOWN ONCE AND NEVER STORED. Put it in your MCP client configuration now:");
  console.log("");
  console.log(`  ${created.presentedKey}`);
  console.log("");
  console.log("Use it as: Authorization: Bearer <that value>   against POST /api/mcp");
  console.log("Do not paste it into a document, a ticket, a screenshot or a commit.");
}

function readOption(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

main()
  .then(() => runtime.end())
  .catch(async (error) => {
    console.error("could not create the key:", error instanceof Error ? error.message : error);
    await runtime.end();
    process.exit(1);
  });
