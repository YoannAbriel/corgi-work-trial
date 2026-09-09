import type postgres from "postgres";
import { sql } from "@/db/client";
import type { UserRole } from "@/lib/auth/current-user";
import { generateApiKey, hashApiKey, PRESENTED_KEY, type PrincipalKind } from "./key-format";

// The shape of a key and its hashing live in ./key-format.ts, which has no database import so
// it can be unit-tested on its own. They are re-exported here so a caller has one place to
// import from.
export * from "./key-format";

// The API keys of the MCP surface, against the database: how a presented key is turned back
// into a user, how a key is created and revoked, and how every call is written down. The shape
// of a key itself is in ./key-format.ts.
//
// Nothing here is ever updated: the three tables of migration 0018 are append-only like the
// money tables. Revoking a key is INSERTING a revocation row, and "revoked" is read as the
// existence of that row. Creating a key returns the secret ONCE; only its sha256 is stored, so
// no code path can ever read it back (AF-05).

// ---------------------------------------------------------------------------
// Turning a presented key back into a principal
// ---------------------------------------------------------------------------

// Everything the endpoint needs to answer a call: which key, who holds it, and what that
// person may see. The user is read from the users table on every call, so revoking a role or
// deleting a user takes effect immediately rather than at the next key rotation.
export type McpPrincipal = {
  keyId: string;
  keyPrefix: string;
  principalKind: PrincipalKind;
  revokedAt: Date | null;
  user: {
    id: string;
    displayName: string;
    role: UserRole;
    brokerId: string | null;
    customerId: string | null;
  };
};

// Returns the principal for a presented key, or null when the value is not one of our keys.
// A REVOKED key is returned too, with revokedAt set: the caller refuses it, and the call is
// still logged against the key it named, because a revoked key still being used is exactly
// what an operator wants to see.
export async function principalForPresentedKey(
  presentedKey: string,
  database: postgres.Sql = sql,
): Promise<McpPrincipal | null> {
  if (!PRESENTED_KEY.test(presentedKey)) {
    return null;
  }
  const [row] = await database<
    {
      id: string;
      key_prefix: string;
      principal_kind: PrincipalKind;
      revoked_at: Date | null;
      user_id: string;
      display_name: string;
      role: UserRole;
      broker_id: string | null;
      customer_id: string | null;
    }[]
  >`
    select key.id, key.key_prefix, key.principal_kind, revocation.recorded_at as revoked_at,
           holder.id as user_id, holder.display_name, holder.role, holder.broker_id, holder.customer_id
      from mcp_api_keys key
      join users holder on holder.id = key.user_id
      left join mcp_key_revocations revocation on revocation.api_key_id = key.id
     where key.key_hash = ${hashApiKey(presentedKey)}
  `;
  if (!row) {
    return null;
  }
  return {
    keyId: row.id,
    keyPrefix: row.key_prefix,
    principalKind: row.principal_kind,
    revokedAt: row.revoked_at,
    user: {
      id: row.user_id,
      displayName: row.display_name,
      role: row.role,
      brokerId: row.broker_id,
      customerId: row.customer_id,
    },
  };
}

// ---------------------------------------------------------------------------
// Creating, revoking and listing keys
// ---------------------------------------------------------------------------

export class KeyRefused extends Error {}

export type CreateApiKeyRequest = {
  userId: string;
  label: string;
  principalKind: PrincipalKind;
  createdByUserId: string | null; // the staff member, or null when a script created it
};

// Creates the key and returns the secret ONCE. The caller shows it to a person and drops it;
// there is no second chance to read it, and no code path that can return it later.
export async function createApiKey(
  request: CreateApiKeyRequest,
  database: postgres.Sql = sql,
): Promise<{ keyId: string; keyPrefix: string; presentedKey: string }> {
  const label = request.label.trim();
  if (label.length === 0) {
    throw new KeyRefused("a key needs a label, so a person can tell it apart from the others");
  }
  const generated = generateApiKey();
  try {
    const [created] = await database<{ id: string }[]>`
      insert into mcp_api_keys (user_id, label, key_prefix, key_hash, principal_kind, created_by)
      values (${request.userId}, ${label}, ${generated.keyPrefix}, ${generated.keyHash},
              ${request.principalKind}, ${request.createdByUserId})
      returning id
    `;
    return { keyId: created.id, keyPrefix: generated.keyPrefix, presentedKey: generated.presentedKey };
  } catch (error) {
    // The database refuses an agent key held by an approver (migration 0018). That is a rule a
    // person can act on, so it becomes a sentence rather than a 500.
    const message = error instanceof Error ? error.message : String(error);
    if (/mcp key:/.test(message)) {
      throw new KeyRefused(message.replace(/^.*mcp key: /, "mcp key: "));
    }
    throw error;
  }
}

export async function revokeApiKey(
  request: { keyId: string; revokedByUserId: string | null; reason: string | null },
  database: postgres.Sql = sql,
): Promise<void> {
  try {
    await database`
      insert into mcp_key_revocations (api_key_id, revoked_by, reason)
      values (${request.keyId}, ${request.revokedByUserId}, ${request.reason})
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/mcp_key_revocations_api_key_id_key/.test(message)) {
      throw new KeyRefused("this key was already revoked");
    }
    if (/mcp_key_revocations_api_key_id_fkey/.test(message)) {
      throw new KeyRefused("this key does not exist");
    }
    throw error;
  }
}

export type ApiKeyListRow = {
  keyId: string;
  keyPrefix: string;
  label: string;
  principalKind: PrincipalKind;
  holderName: string;
  holderEmail: string;
  holderRole: UserRole;
  createdAt: Date;
  createdByName: string | null;
  revokedAt: Date | null;
  revokedByName: string | null;
  lastCallAt: Date | null;
  callCount: number;
};

// What /ops/mcp-keys shows: every key ever created, revoked ones included, with when it was
// last used. A revoked key is never removed from the list: the row is the history.
export async function listApiKeys(database: postgres.Sql = sql): Promise<ApiKeyListRow[]> {
  const rows = await database<
    {
      id: string;
      key_prefix: string;
      label: string;
      principal_kind: PrincipalKind;
      holder_name: string;
      holder_email: string;
      holder_role: UserRole;
      created_at: Date;
      created_by_name: string | null;
      revoked_at: Date | null;
      revoked_by_name: string | null;
      last_call_at: Date | null;
      call_count: string;
    }[]
  >`
    select key.id, key.key_prefix, key.label, key.principal_kind,
           holder.display_name as holder_name, holder.email as holder_email, holder.role as holder_role,
           key.created_at, creator.display_name as created_by_name,
           revocation.recorded_at as revoked_at, revoker.display_name as revoked_by_name,
           usage.last_call_at, coalesce(usage.call_count, 0)::text as call_count
      from mcp_api_keys key
      join users holder on holder.id = key.user_id
      left join users creator on creator.id = key.created_by
      left join mcp_key_revocations revocation on revocation.api_key_id = key.id
      left join users revoker on revoker.id = revocation.revoked_by
      left join (
        select api_key_id, max(called_at) as last_call_at, count(*) as call_count
          from mcp_calls where api_key_id is not null group by api_key_id
      ) usage on usage.api_key_id = key.id
     order by key.created_at desc
  `;
  return rows.map((row) => ({
    keyId: row.id,
    keyPrefix: row.key_prefix,
    label: row.label,
    principalKind: row.principal_kind,
    holderName: row.holder_name,
    holderEmail: row.holder_email,
    holderRole: row.holder_role,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    revokedAt: row.revoked_at,
    revokedByName: row.revoked_by_name,
    lastCallAt: row.last_call_at,
    callCount: Number(row.call_count),
  }));
}

// ---------------------------------------------------------------------------
// The call log
// ---------------------------------------------------------------------------

export type McpCallRecord = {
  apiKeyId: string | null;
  method: string;
  tool: string | null;
  argumentsHash: string | null;
  outcome: "ok" | "refused" | "error" | "unauthorised";
  detail: string | null;
  durationMs: number;
};

// One row per call, always, whatever the answer was. It is written after the answer is built,
// so a slow tool does not hold a row open, and it never carries the arguments themselves: only
// their fingerprint (hashArguments above) and one sanitised sentence.
//
// THE LAST BOUND BEFORE THE ROW IS WRITTEN. The callers already choose fixed sentences rather
// than echoing the caller (lib/mcp/jsonrpc.ts, app/api/mcp/route.ts), and this is the second
// line: three lengths, applied here so that no future caller of this function can put an
// unbounded string into a table that has an UPDATE trigger, a DELETE trigger and a TRUNCATE
// trigger (review finding F-B11-02).
const LONGEST_METHOD = 64;
const LONGEST_TOOL_NAME = 64;
const LONGEST_DETAIL = 500;

export async function recordMcpCall(record: McpCallRecord, database: postgres.Sql = sql): Promise<void> {
  await database`
    insert into mcp_calls (api_key_id, method, tool, arguments_hash, outcome, detail, duration_ms)
    values (${record.apiKeyId}, ${record.method.slice(0, LONGEST_METHOD)},
            ${record.tool === null ? null : record.tool.slice(0, LONGEST_TOOL_NAME)},
            ${record.argumentsHash},
            ${record.outcome}, ${record.detail === null ? null : record.detail.slice(0, LONGEST_DETAIL)},
            ${Math.max(0, Math.round(record.durationMs))})
  `;
}
