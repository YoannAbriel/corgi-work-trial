import "@/app/styles/lists.css";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { Chip } from "@/components/detail-layout";
import { About } from "@/components/ui/about";
import { EmptyState } from "@/components/ui/empty";
import { Inspector } from "@/components/ui/inspector";
import { Legend } from "@/components/ui/legend";
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

// The deployed endpoint a client is pointed at. It is the address of the trial deployment, which
// is what a reader has to type into their own configuration; the route itself is app/api/mcp.
const MCP_ENDPOINT = "https://corgi-work-trial-iota.vercel.app/api/mcp";
const connectCommand = `claude mcp add --transport http corgi-trial ${MCP_ENDPOINT} --header "Authorization: Bearer <key>"`;

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

  // The revocation toast says a sentence: `?revoked=1` used to show a toast whose body was the
  // bare value "1" (feedback audit of 2026-09-09). `toastsFromQuery` puts the parameter's value
  // in the body, so the wording is set here.
  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    revoked: { tone: "ok", title: "Key revoked" },
  }).map((notice) => (notice.param === "revoked" ? { ...notice, text: "It answers 401 from now on." } : notice));
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
        // Two chips (cycle 2, decision 1): how many keys answer, and how many an agent holds.
        // What a write tool may do is a rule, and a rule belongs in About.
        meta: (
          <>
            <Chip tone={live > 0 ? "ok" : "neutral"}>{live} live</Chip>
            <Chip tone={agentKeys > 0 ? "warn" : "neutral"}>{agentKeys} held by an agent</Chip>
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

      {/* Two tiles (cycle 2, decision 2). The number of tools is on the list of them below, and
          the number of calls is the sum of a column of the table. */}
      <Stats>
        <Stat label="Live keys" value={live} tone={live > 0 ? "ok" : "neutral"} note="answer the endpoint today" />
        <Stat label="Agent keys" value={agentKeys} tone={agentKeys > 0 ? "warn" : "neutral"} note={`${calls} calls recorded in all`} />
      </Stats>

      {/* The screen reads like the settings page of an API provider (cycle 2, decision 20): the
          endpoint, what a client has to send, and the tools the endpoint exposes. */}
      <section className="card lists-section">
        <h2>Connect a client</h2>
        <div className="lists-facts">
          <div>
            Endpoint <b>POST {MCP_ENDPOINT}</b>, streamable HTTP, JSON-RPC 2.0
          </div>
          <div>
            Header <b>Authorization: Bearer &lt;key&gt;</b>, the secret shown once when the key is created
          </div>
          <div>
            <b>{MCP_TOOLS.length} tools</b> answer <code>tools/list</code>, with what each one may do
          </div>
        </div>
        <code className="lists-snippet">{connectCommand}</code>
        <p className="note">
          The MCP Inspector takes the same URL and the same header. A GET answers 405; a wrong or revoked key answers 401.
        </p>
      </section>

      <section className="card lists-section lists-form-card">
        <h2>Create a key</h2>
        <form method="post" action="/api/mcp-keys" className="card lists-form">
          <input type="hidden" name="action" value="create" />

          {/* Short options: a select cuts what does not fit, mid-word and with no ellipsis, so
              an option is a name and a role and nothing more (round 1, MEDIUM). */}
          <label htmlFor="userId">Whose eyes this key has</label>
          <select id="userId" name="userId" required>
            {holders.map((holder) => (
              <option key={holder.id} value={holder.id}>
                {holder.display_name}, {holder.role}
              </option>
            ))}
          </select>

          <label htmlFor="label">Label</label>
          <input id="label" name="label" type="text" required placeholder="Claude Desktop, demo laptop" />

          <label htmlFor="principalKind">Who holds it</label>
          <select id="principalKind" name="principalKind" required defaultValue="agent">
            <option value="agent">An autonomous agent</option>
            <option value="human">A person using an MCP client</option>
          </select>

          <SubmitButton>Create the key and show the secret once</SubmitButton>
        </form>
      </section>

      <DataTable
        ariaLabel="MCP API keys"
        legend={
          <Legend
            items={[
              { term: "live", meaning: "answers the endpoint today" },
              { term: "revoked", meaning: "answers 401 from now on; the row stays for ever" },
            ]}
          />
        }
      >
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
                  {/* The label the operator typed, on one line, whole value in `title`: broken
                      across lines it split a date in half, "2026-" then "09-08" (round 1). The
                      key's own instant is the Created column, through `When`. */}
                  <span className="dt-sub lists-one-line" title={key.label}>
                    {key.label}
                  </span>
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
        <h4>Who holds the key</h4>
        <p>
          An autonomous agent, or a person using an MCP client. A request raised with an agent&apos;s key is marked agent-raised, and a write tool never does more than put a request in the approval queue: a second, human approver decides.
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
