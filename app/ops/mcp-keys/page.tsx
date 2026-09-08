import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { listApiKeys } from "@/lib/mcp/keys";
import { NEVER_DELEGATED } from "@/lib/mcp/never-delegated";
import { MCP_TOOLS } from "@/lib/mcp/tools";

// /ops/mcp-keys: the keys that open the MCP endpoint, who holds them, and what they have done.
//
// Staff only. Two actions, both of which write one row and never edit one: creating a key
// (the secret is shown once, on the answer page, and is never stored) and revoking one (a
// revocation row; the key stays on this list for ever, marked revoked).
//
// The page also lists the tools and the never-delegated operations, so the rule an agent is
// held to is readable by the person handing out the key, not only by the agent.
export default async function McpKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; revoked?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    redirect("/broker");
  }

  const [keys, holders, query] = await Promise.all([
    listApiKeys(sql),
    // Who a key can be issued for. An 'agent' user is included: it is a principal that exists
    // only to hold a key. A staff_approver is included too, but only a 'human' key can be
    // created for one, and the database refuses the other case (migration 0018).
    sql<{ id: string; display_name: string; email: string; role: string }[]>`
      select id, display_name, email, role from users order by role, display_name
    `,
    searchParams,
  ]);

  return (
    <PortalShell user={user} active="mcp-keys">
      <h1>MCP API keys</h1>
      <p className="lead">
        One key, one user. Every tool answers with exactly what that user may see on these screens, and nothing more.
        The secret is shown once when the key is created and is never stored: only its sha256 and its public prefix are.
      </p>
      <p className="note">
        Endpoint: <code>POST /api/mcp</code>, streamable HTTP, JSON-RPC 2.0, with{" "}
        <code>Authorization: Bearer &lt;key&gt;</code>. A wrong or revoked key answers 401. Every call is recorded in
        <code> mcp_calls</code>, including the ones that were refused.
      </p>

      {query.error ? <p className="error" role="alert">{query.error}</p> : null}
      {query.revoked ? <p className="note" role="status">The key was revoked. It answers 401 from now on.</p> : null}

      <h2>Create a key</h2>
      <form method="post" action="/api/mcp-keys" className="card">
        <input type="hidden" name="action" value="create" />

        <label htmlFor="userId">Whose eyes this key has</label>
        <select id="userId" name="userId" required>
          {holders.map((holder) => (
            <option key={holder.id} value={holder.id}>
              {holder.display_name} ({holder.role}) {holder.email}
            </option>
          ))}
        </select>

        <label htmlFor="label">Label</label>
        <input id="label" name="label" type="text" required placeholder="Claude Desktop, demo laptop" />

        <label htmlFor="principalKind">Who holds it</label>
        <select id="principalKind" name="principalKind" required defaultValue="agent">
          <option value="agent">An autonomous agent (requests it raises are marked as agent-raised)</option>
          <option value="human">A person using an MCP client</option>
        </select>

        <button type="submit">Create the key and show the secret once</button>
      </form>
      <p className="note">
        An agent key cannot be created for a staff approver: the database refuses it, because an agent must never hold
        the visibility of the one role that can approve money out.
      </p>

      <h2>Keys</h2>
      {keys.length === 0 ? (
        <p className="note">No key has been created yet. The seed deliberately creates none: a seed that printed a
          secret would put it in a terminal log.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="MCP API keys" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Prefix</th>
              <th>Label</th>
              <th>Holder</th>
              <th>Kind</th>
              <th>Created</th>
              <th>Calls</th>
              <th>Last call</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.keyId}>
                <td>
                  <code>{key.keyPrefix}</code>
                </td>
                <td>{key.label}</td>
                <td>
                  {key.holderName} ({key.holderRole})
                </td>
                <td>
                  {key.principalKind === "agent" ? <span className="badge badge-warn">agent</span> : "person"}
                </td>
                <td>
                  {key.createdAt.toISOString().slice(0, 19)} UTC
                  {key.createdByName ? ` by ${key.createdByName}` : " by a script"}
                </td>
                <td>{key.callCount}</td>
                <td>{key.lastCallAt ? `${key.lastCallAt.toISOString().slice(0, 19)} UTC` : "never used"}</td>
                <td>
                  {key.revokedAt ? (
                    <>
                      <span className="badge">revoked</span> {key.revokedAt.toISOString().slice(0, 19)} UTC
                      {key.revokedByName ? ` by ${key.revokedByName}` : ""}
                    </>
                  ) : (
                    <form method="post" action="/api/mcp-keys" className="inline-form">
                      <input type="hidden" name="action" value="revoke" />
                      <input type="hidden" name="keyId" value={key.keyId} />
                      <button type="submit">Revoke</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <h2>What a key can do</h2>
      <ul>
        {MCP_TOOLS.map((tool) => (
          <li key={tool.name}>
            <code>{tool.name}</code>: {tool.description}
          </li>
        ))}
      </ul>

      <h2>Never delegated to an agent</h2>
      <p className="note">
        The same list is returned by <code>tools/list</code> under <code>policy</code>, so an agent reading the surface
        sees it too.
      </p>
      <ul>
        {NEVER_DELEGATED.map((operation) => (
          <li key={operation.operation}>
            <strong>{operation.operation}</strong>: {operation.reason}
          </li>
        ))}
      </ul>
    </PortalShell>
  );
}
