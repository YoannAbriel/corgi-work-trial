import "@/app/styles/lists.css";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components/portal-shell";
import { Chip } from "@/components/detail-layout";
import { About } from "@/components/ui/about";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty";
import { Inspector } from "@/components/ui/inspector";
import { Legend } from "@/components/ui/legend";
import { Stat, Stats } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DataTable, Ref, Row, RowMenu } from "@/components/ui/table";
import { Toolbar, ToolbarCount, ToolbarSpacer } from "@/components/ui/toolbar";
import { When } from "@/components/ui/time";
import { sql } from "@/db/client";
import { currentUser } from "@/lib/auth/current-user";
import {
  DEFAULT_TOKEN_LIFETIME,
  keyPrefixOf,
  listApiKeys,
  tokenExpiresSoon,
  tokenHasExpired,
  TOKEN_LIFETIMES,
  type ApiKeyListRow,
} from "@/lib/mcp/keys";
import { NEVER_DELEGATED } from "@/lib/mcp/never-delegated";
import { TOKEN_REVEAL_COOKIE } from "@/lib/mcp/token-reveal";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import {
  closeInspectorHref,
  firstValue,
  inspectedReference,
  inspectHref,
  pickView,
  toastsFromQuery,
  withParams,
  type Query,
} from "@/lib/ui/views";

// /ops/mcp-keys: the access tokens that open the MCP endpoint, who holds them, when they stop
// answering and what they have done.
//
// Staff operations only, never an approver. Three actions, none of which ever edits a row:
// creating a token (the secret is shown once, in the drawer, and is never stored), revoking one
// (a revocation row; the token stays on this list for ever, marked revoked) and dismissing the
// secret this browser was just shown.
//
// TWO VIEWS (Yoann, 2026-09-09). "Tokens" is the table, in the shape of an API provider's key
// page: name, account, expiry, last use, status, a row menu. "Connect a client" is everything
// about the endpoint itself, which a reader needs once, when setting a client up, and never
// again: the URL, the header, the snippets, the tools and the operations never delegated.

const PATH = "/ops/mcp-keys";

const VIEWS = ["tokens", "connect"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { tokens: "Tokens", connect: "Connect" };

// The deployed endpoint a client is pointed at. It is the address of the trial deployment, which
// is what a reader has to type into their own configuration; the route itself is app/api/mcp.
const MCP_ENDPOINT = "https://corgi-work-trial-iota.vercel.app/api/mcp";
const connectCommand = (token: string) =>
  `claude mcp add --transport http corgi-trial ${MCP_ENDPOINT} --header "Authorization: Bearer ${token}"`;

export default async function AccessTokensPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  // Staff operations only, the same allowlist as POST /api/mcp-keys and for the same reason
  // (review finding F-INT-01): the person who decides a money-out must not be able to act as
  // the person who requests one, and minting a token for the maker is exactly that.
  if (user.role !== "staff_ops") {
    redirect(user.role === "staff_approver" ? "/ops" : "/broker");
  }

  const [tokens, holders, query] = await Promise.all([
    listApiKeys(sql),
    // Which account a token can be issued for. An 'agent' user is included: it is a principal
    // that exists only to hold a token. A staff_approver is included too, but only a token used
    // by a person can be created for one, and the database refuses the other case (0018).
    sql<{ id: string; display_name: string; email: string; role: string }[]>`
      select id, display_name, email, role from users order by role, display_name
    `,
    searchParams,
  ]);

  const now = new Date();
  const view = pickView(query.view, VIEWS);
  const active = tokens.filter((token) => statusOf(token, now) === "active").length;
  const agentTokens = tokens.filter((token) => token.principalKind === "agent" && statusOf(token, now) === "active").length;
  const expiringSoon = tokens.filter((token) => statusOf(token, now) === "active" && tokenExpiresSoon(token.expiresAt, now)).length;
  const calls = tokens.reduce((total, token) => total + token.callCount, 0);

  // The search is server side over the rows already read: a token is found by the name a person
  // typed or by its public prefix, which is what somebody reading a log or a call row holds.
  const search = (firstValue(query.q) ?? "").trim().toLowerCase();
  const shown =
    search === ""
      ? tokens
      : tokens.filter((token) => `${token.label} ${token.keyPrefix} ${token.holderName}`.toLowerCase().includes(search));

  // The revocation toast says a sentence: `?revoked=1` used to show a toast whose body was the
  // bare value "1" (feedback audit of 2026-09-09). The rule's own `text` replaces that value.
  const toasts = toastsFromQuery(query, {
    error: { tone: "error", title: "Refused" },
    revoked: { tone: "ok", title: "Token revoked", text: "It answers 401 from now on." },
    created: { tone: "ok", title: "Token created", text: "Copy it now. It is shown once and never stored." },
  });
  const inspected = inspectedReference(query.inspect);

  // The secret of the token this browser has just created, for at most 120 seconds, read from the
  // httpOnly cookie POST /api/mcp-keys set (see that file for why a cookie and not the URL). It
  // is shown only when it belongs to the prefix the URL names, so a stale cookie cannot make the
  // drawer of another token appear.
  const createdPrefix = firstValue(query.created) ?? null;
  const cookieStore = await cookies();
  const revealedToken = cookieStore.get(TOKEN_REVEAL_COOKIE)?.value ?? null;
  const revealed = createdPrefix !== null && revealedToken !== null && keyPrefixOf(revealedToken) === createdPrefix ? revealedToken : null;

  const isCreating = firstValue(query.new) === "1";
  const closeDrawerHref = withParams(PATH, query, { new: null, inspect: null });

  const views = VIEWS.map((one) => ({
    key: one,
    label: VIEW_LABEL[one],
    href: withParams(PATH, query, { view: one, inspect: null, new: null }),
    current: one === view,
  }));

  return (
    <PortalShell
      user={user}
      active="mcp-keys"
      views={views}
      toasts={toasts}
      // One drawer at a time, in the order of what the reader just did: the token they have this
      // second and can never see again, then the form they opened, then the trail of a prefix.
      inspector={
        revealed ? (
          <NewTokenDrawer token={revealed} prefix={createdPrefix ?? ""} closeHref={PATH} />
        ) : isCreating ? (
          <CreateTokenDrawer holders={holders} closeHref={closeDrawerHref} />
        ) : inspected ? (
          <Inspector reference={inspected} closeHref={closeInspectorHref(PATH, query)} user={user} now={now} />
        ) : undefined
      }
      band={{
        title: "Access tokens",
        suffix: `${tokens.length} ever created`,
        // Two chips (cycle 2, decision 1): how many tokens answer, and how many an agent holds.
        // What a write tool may do is a rule, and a rule belongs in About.
        meta: (
          <>
            <Chip tone={active > 0 ? "ok" : "neutral"}>{active} active</Chip>
            <Chip tone={agentTokens > 0 ? "warn" : "neutral"}>{agentTokens} used by an agent</Chip>
          </>
        ),
        actions: (
          <>
            {/* The secondary button is the other view, named: on the table it opens the client
                instructions, on those instructions it goes back to the table. */}
            <Link
              className="button-link secondary"
              href={withParams(PATH, query, { view: view === "connect" ? "tokens" : "connect", new: null })}
              prefetch={false}
            >
              {view === "connect" ? "Tokens" : "Connect"}
            </Link>
            <Link className="button-link" href={withParams(PATH, query, { view: "tokens", new: "1" })} prefetch={false} scroll={false}>
              New token
            </Link>
          </>
        ),
      }}
    >
      {query.error ? (
        <div className="notices">
          <p className="error" role="alert">
            {query.error}
          </p>
        </div>
      ) : null}

      {view === "connect" ? (
        <ConnectView />
      ) : (
        <>
          {/* Two tiles (cycle 2, decision 2). The number of tokens is on the band, the number of
              calls is the sum of a column of the table. */}
          <Stats>
            <Stat
              label="Active tokens"
              value={active}
              tone={active > 0 ? "ok" : "neutral"}
              note={expiringSoon > 0 ? `${expiringSoon} expire within 7 days` : "answer the endpoint today"}
            />
            <Stat
              label="Used by an agent"
              value={agentTokens}
              tone={agentTokens > 0 ? "warn" : "neutral"}
              note={`${calls} calls recorded in all`}
            />
          </Stats>

          <DataTable
            ariaLabel="Access tokens"
            toolbar={
              <Toolbar>
                <form method="get" action={PATH} className="lists-search">
                  <input type="search" name="q" defaultValue={search} placeholder="Name or prefix" aria-label="Search tokens" />
                  <button type="submit" className="secondary">
                    Search
                  </button>
                </form>
                <ToolbarSpacer />
                <ToolbarCount>
                  {shown.length} of {tokens.length}
                </ToolbarCount>
              </Toolbar>
            }
            legend={
              <Legend
                items={[
                  { term: "active", meaning: "answers the endpoint today" },
                  { term: "expired", meaning: "its expiration passed; it answers 401, and the row stays for ever" },
                  { term: "revoked", meaning: "answers 401 from now on; the row stays for ever" },
                ]}
              />
            }
            footer={<div className="dt-more">{tokens.length} tokens</div>}
          >
            <thead>
              <tr>
                <th>Name</th>
                <th>Account</th>
                <th className="nowrap">Expires</th>
                <th className="nowrap">Last used</th>
                <th>Status</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dt-empty">
                    <EmptyState illustration="key-ring">
                      {tokens.length === 0
                        ? "No token yet. The seed creates none: a seed that printed a secret would put it in a terminal log."
                        : "No token matches this search."}
                    </EmptyState>
                  </td>
                </tr>
              ) : (
                shown.map((token) => {
                  const status = statusOf(token, now);
                  return (
                    <Row key={token.keyId}>
                      <td>
                        {/* The name a person typed, on one line, whole value in `title`: broken
                            across lines it split a date in half, "2026-" then "09-08" (round 1).
                            The masked prefix under it is the clickable reference. */}
                        <span className="lists-one-line" title={token.label}>
                          {token.label}
                        </span>
                        <span className="dt-sub">
                          <Ref
                            value={token.keyPrefix}
                            inspectHref={inspectHref(PATH, query, token.keyPrefix)}
                            open={inspected === token.keyPrefix}
                          />
                        </span>
                      </td>
                      <td>
                        {token.holderName}
                        <span className="dt-sub">
                          {token.holderRole}, {token.principalKind === "agent" ? "an agent" : "a person"}
                        </span>
                      </td>
                      <td className="nowrap">
                        {token.expiresAt === null ? (
                          <span className="dt-muted">never</span>
                        ) : status === "expired" ? (
                          <Chip tone="neutral">expired</Chip>
                        ) : tokenExpiresSoon(token.expiresAt, now) ? (
                          <>
                            <Chip tone="warn">
                              <When instant={token.expiresAt} now={now} />
                            </Chip>
                            <span className="dt-sub">{daysLeft(token.expiresAt, now)}</span>
                          </>
                        ) : (
                          <>
                            <When instant={token.expiresAt} now={now} />
                            <span className="dt-sub">{daysLeft(token.expiresAt, now)}</span>
                          </>
                        )}
                      </td>
                      <td className="nowrap">
                        <When instant={token.lastCallAt} now={now} />
                        <span className="dt-sub">{token.callCount} calls</span>
                      </td>
                      <td>
                        <Chip tone={status === "active" ? "ok" : "neutral"}>{status}</Chip>
                        {status === "revoked" ? (
                          <span className="dt-sub">{token.revokedByName ? `by ${token.revokedByName}` : "by a script"}</span>
                        ) : null}
                      </td>
                      <td className="dt-actions">
                        <RowMenu id={token.keyId} label={`Actions for ${token.label}`}>
                          <Link href={inspectHref(PATH, query, token.keyPrefix)} prefetch={false} scroll={false}>
                            Open trail
                          </Link>
                          {token.revokedAt === null ? (
                            <form method="post" action="/api/mcp-keys" className="inline-form">
                              <input type="hidden" name="action" value="revoke" />
                              <input type="hidden" name="keyId" value={token.keyId} />
                              <SubmitButton className="secondary small">Revoke</SubmitButton>
                            </form>
                          ) : null}
                        </RowMenu>
                      </td>
                    </Row>
                  );
                })
              )}
            </tbody>
          </DataTable>

          <About>
            <h4>One token, one account</h4>
            <p>
              A token borrows the visibility of the account it belongs to: every tool answers with exactly what that person may see on these screens, and nothing more. The secret is shown once when the token is created and is never stored: only its sha256 and its public prefix are.
            </p>
            <h4>Expiration</h4>
            <p>
              A token stops answering on its own at the instant it was given when it was created. That instant is written once and can never be moved: extending a token means creating another one and revoking this one. A token created before this rule existed has no expiration and answers until it is revoked.
            </p>
            <h4>Revoking</h4>
            <p>
              Revoking appends a row; it never edits one. The token stays on this list for ever, marked revoked, and answers 401 from that moment. Expired and revoked are refused by the endpoint in exactly the same way.
            </p>
            <h4>An agent token for an approver</h4>
            <p>The database refuses it: an agent must never hold the visibility of the one role that can approve money out.</p>
          </About>
        </>
      )}
    </PortalShell>
  );
}

// ---------------------------------------------------------------------------
// The state of a token, read the same way here and by the endpoint
// ---------------------------------------------------------------------------

// Revoked wins over expired: a token somebody took away is a decision, and a decision is what an
// operator wants to read on the row, whatever the clock says afterwards.
type TokenStatus = "active" | "expired" | "revoked";

// How long a token that has not expired yet still has. `When` prints a future instant as its
// date, which is the fact; this is the reading of it a person actually wants on the row.
function daysLeft(expiresAt: Date, now: Date): string {
  const days = Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return days <= 1 ? "less than a day left" : `${days} days left`;
}

function statusOf(token: ApiKeyListRow, now: Date): TokenStatus {
  if (token.revokedAt !== null) return "revoked";
  if (tokenHasExpired(token.expiresAt, now)) return "expired";
  return "active";
}

// ---------------------------------------------------------------------------
// The two drawers
// ---------------------------------------------------------------------------

// The form, in the drawer the whole workspace uses (cycle 2, decisions 5 and 6). It posts the
// same fields the route has always read, plus the expiration.
function CreateTokenDrawer({
  holders,
  closeHref,
}: {
  holders: { id: string; display_name: string; role: string }[];
  closeHref: string;
}) {
  return (
    <Drawer title="New token" kind="Access tokens" closeHref={closeHref}>
      <form method="post" action="/api/mcp-keys" className="card lists-form">
        <input type="hidden" name="action" value="create" />

        {/* Short options: a select cuts what does not fit, mid-word and with no ellipsis, so an
            option is a name and a role and nothing more (round 1, MEDIUM). */}
        <label htmlFor="userId">Account</label>
        <select id="userId" name="userId" required>
          {holders.map((holder) => (
            <option key={holder.id} value={holder.id}>
              {holder.display_name}, {holder.role}
            </option>
          ))}
        </select>

        <label htmlFor="label">Name</label>
        <input id="label" name="label" type="text" required placeholder="Claude Desktop, laptop" />

        <label htmlFor="principalKind">Used by</label>
        <select id="principalKind" name="principalKind" required defaultValue="agent">
          <option value="agent">An agent</option>
          <option value="human">A person</option>
        </select>

        <label htmlFor="expiresIn">Expiration</label>
        <select id="expiresIn" name="expiresIn" required defaultValue={DEFAULT_TOKEN_LIFETIME}>
          {TOKEN_LIFETIMES.map((lifetime) => (
            <option key={lifetime.value} value={lifetime.value}>
              {lifetime.label}
            </option>
          ))}
        </select>

        <SubmitButton>Create</SubmitButton>
      </form>
    </Drawer>
  );
}

// The one place in this application that ever shows a secret. It is read from the cookie that
// carried it here and is gone from the browser as soon as Done is pressed, or after 120 seconds.
function NewTokenDrawer({ token, prefix, closeHref }: { token: string; prefix: string; closeHref: string }) {
  return (
    <Drawer title={`Token ${prefix}`} kind="Created just now" closeHref={closeHref}>
      <div className="lists-token-panel">
        <p className="note">Copy it now. It is shown once and never stored.</p>
        <code className="lists-snippet lists-token">{token}</code>
        <div>
          <h3>Connect a client</h3>
          <code className="lists-snippet">{connectCommand(token)}</code>
        </div>
        <p className="note">
          The database holds its sha256 and its public prefix, so nobody, including this application, can read it back. Lost means creating another token and revoking this one. Do not paste it into a document, a ticket or a commit.
        </p>
        <form method="post" action="/api/mcp-keys" className="inline-form">
          <input type="hidden" name="action" value="dismiss" />
          <SubmitButton>Done</SubmitButton>
        </form>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// The second view: what a client has to be told
// ---------------------------------------------------------------------------

function ConnectView() {
  return (
    <>
      <section className="card lists-section">
        <h2>Connect a client</h2>
        <div className="lists-facts">
          <div>
            Endpoint <b>POST {MCP_ENDPOINT}</b>, streamable HTTP, JSON-RPC 2.0
          </div>
          <div>
            Header <b>Authorization: Bearer &lt;token&gt;</b>, the secret shown once when the token is created
          </div>
          <div>
            <b>{MCP_TOOLS.length} tools</b> answer <code>tools/list</code>, with what each one may do
          </div>
        </div>
        <code className="lists-snippet">{connectCommand("<token>")}</code>
        <p className="note">
          The MCP Inspector takes the same URL and the same header. A GET answers 405; a wrong, revoked or expired token answers 401.
        </p>
      </section>

      <About>
        <h4>The endpoint</h4>
        <p>
          <code>POST /api/mcp</code>, streamable HTTP, JSON-RPC 2.0, with <code>Authorization: Bearer &lt;token&gt;</code>. A wrong or revoked token answers 401, and so does an expired one. Every call is recorded in <code>mcp_calls</code>, including the ones that were refused.
        </p>
        <h4>Who uses the token</h4>
        <p>
          An autonomous agent, or a person using an MCP client. A request raised with an agent&apos;s token is marked agent-raised, and a write tool never does more than put a request in the approval queue: a second, human approver decides.
        </p>
        <h4>What a token can do</h4>
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
    </>
  );
}
