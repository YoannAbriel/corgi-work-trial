import "@/app/styles/lists.css";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { Chip } from "@/components/detail-layout";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Inspector } from "@/components/ui/inspector";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, Ref, Row } from "@/components/ui/table";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { listApiKeys } from "@/lib/mcp/keys";
import { NEVER_DELEGATED } from "@/lib/mcp/never-delegated";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { closeInspectorHref, inspectedReference, inspectHref, toastsFromQuery, type Query } from "@/lib/ui/views";

// /ops/mcp-keys: the keys that open the MCP endpoint, who holds them, and what they have done.
//
// Staff operations only, never an approver. Two actions, both of which write one row and never
// edit one: creating a key (the secret is shown once, on the answer page of POST /api/mcp-keys,
// and is never stored) and revoking one (a revocation row; the key stays on this list for ever,
// marked revoked).
//
// The page also lists the tools and the never-delegated operations, so the rule an agent is
// held to is readable by the person handing out the key, not only by the agent.

const PATH = "/ops/mcp-keys";

export default async function McpKeysPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  // Staff operations only, the same allowlist as POST /api/mcp-keys and for the same reason
  // (review finding F-INT-01): the person who decides a money-out must not be able to act as
  // the person who requests one, and minting a key for the maker is exactly that.
  if (user.role !== "staff_ops") {
    redirect(user.role === "staff_approver" ? "/ops" : "/broker");
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

  const now = new Date();
  const live = keys.filter((key) => key.revokedAt === null).length;
  const agentKeys = keys.filter((key) => key.principalKind === "agent" && key.revokedAt === null).length;
  const calls = keys.reduce((total, key) => total + key.callCount, 0);

  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    revoked: { tone: "ok", title: "Key revoked" },
  });
  const inspected = inspectedReference(query.inspect);

  return (
    <PortalShell
      user={user}
      active="mcp-keys"
      toasts={toasts}
      inspector={
        inspected ? <Inspector reference={inspected} closeHref={closeInspectorHref(PATH, query)} user={user} now={now} /> : undefined
      }
      band={{
        title: "MCP keys",
        suffix: `${keys.length} ever created`,
        meta: (
          <>
            <Chip tone={live > 0 ? "ok" : "neutral"}>{live} live</Chip>
            <Chip tone={agentKeys > 0 ? "warn" : "neutral"}>{agentKeys} held by an agent</Chip>
            <Chip tone="neutral">write tools: approval queue only</Chip>
          </>
        ),
      }}
    >
      {query.error || query.revoked ? (
        <div className="notices">
          {query.error ? (
            <p className="error" role="alert">
              {query.error}
            </p>
          ) : null}
          {query.revoked ? (
            <p className="note" role="status">
              The key was revoked. It answers 401 from now on.
            </p>
          ) : null}
        </div>
      ) : null}

      <Stats>
        <Stat label="Live keys" value={live} tone={live > 0 ? "ok" : "neutral"} note="answer the endpoint today" />
        <Stat label="Agent keys" value={agentKeys} tone={agentKeys > 0 ? "warn" : "neutral"} note="requests they raise are marked agent-raised" />
        <Stat label="Calls" value={calls} note="recorded in mcp_calls, refusals included" />
        <Stat label="Tools" value={MCP_TOOLS.length} note="what any key can do, and nothing more" />
      </Stats>

      <section className="card lists-section">
        <h2>Create a key</h2>
        <form method="post" action="/api/mcp-keys" className="card lists-form">
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

          <SubmitButton>Create the key and show the secret once</SubmitButton>
        </form>
      </section>

      <DataTable ariaLabel="MCP API keys">
        <thead>
          <tr>
            <th>Prefix</th>
            <th>Holder</th>
            <th className="nowrap">Created</th>
            <th className="nowrap">Last used</th>
            <th>Status</th>
            <th className="num">Actions</th>
          </tr>
        </thead>
        <tbody>
          {keys.length === 0 ? (
            <tr>
              <td colSpan={6} className="dt-empty">
                <EmptyState illustration="key-ring">
                  No key yet. The seed creates none: a seed that printed a secret would put it in a terminal log.
                </EmptyState>
              </td>
            </tr>
          ) : (
            keys.map((key) => (
              <Row key={key.keyId}>
                <td>
                  <Ref value={key.keyPrefix} inspectHref={inspectHref(PATH, query, key.keyPrefix)} open={inspected === key.keyPrefix} />
                  <span className="dt-sub">{key.label}</span>
                </td>
                <td>
                  {key.holderName}
                  <span className="dt-sub">
                    {key.holderRole}, {key.principalKind === "agent" ? "agent" : "person"}
                  </span>
                </td>
                <td className="nowrap">
                  <When instant={key.createdAt} now={now} />
                  <span className="dt-sub">{key.createdByName ? `by ${key.createdByName}` : "by a script"}</span>
                </td>
                <td className="nowrap">
                  <When instant={key.lastCallAt} now={now} />
                  <span className="dt-sub">{key.callCount} calls</span>
                </td>
                <td>
                  <Chip tone={key.revokedAt ? "neutral" : "ok"}>{key.revokedAt ? "revoked" : "live"}</Chip>
                  {key.revokedAt ? (
                    <span className="dt-sub">{key.revokedByName ? `by ${key.revokedByName}` : "by a script"}</span>
                  ) : null}
                </td>
                <td className="dt-actions">
                  {key.revokedAt ? (
                    <span className="dt-muted">nothing to do</span>
                  ) : (
                    <form method="post" action="/api/mcp-keys" className="inline-form">
                      <input type="hidden" name="action" value="revoke" />
                      <input type="hidden" name="keyId" value={key.keyId} />
                      <SubmitButton className="secondary small">Revoke</SubmitButton>
                    </form>
                  )}
                </td>
              </Row>
            ))
          )}
        </tbody>
      </DataTable>

      <About>
        <h4>One key, one user</h4>
        <p>
          Every tool answers with exactly what that user may see on these screens, and nothing more. The secret is shown once when the key is created and is never stored: only its sha256 and its public prefix are.
        </p>
        <h4>The endpoint</h4>
        <p>
          <code>POST /api/mcp</code>, streamable HTTP, JSON-RPC 2.0, with <code>Authorization: Bearer &lt;key&gt;</code>. A wrong or revoked key answers 401. Every call is recorded in <code>mcp_calls</code>, including the ones that were refused.
        </p>
        <h4>An agent key for an approver</h4>
        <p>The database refuses it: an agent must never hold the visibility of the one role that can approve money out.</p>
        <h4>What a key can do</h4>
        <ul>
          {MCP_TOOLS.map((tool) => (
            <li key={tool.name}>
              <code>{tool.name}</code>: {tool.description}
            </li>
          ))}
        </ul>
        <h4>Never delegated to an agent</h4>
        <p>
          The same list is returned by <code>tools/list</code> under <code>policy</code>, so an agent reading the surface sees it too.
        </p>
        <ul>
          {NEVER_DELEGATED.map((operation) => (
            <li key={operation.operation}>
              <strong>{operation.operation}</strong>: {operation.reason}
            </li>
          ))}
        </ul>
      </About>
    </PortalShell>
  );
}
