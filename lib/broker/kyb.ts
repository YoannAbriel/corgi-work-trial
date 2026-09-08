import type postgres from "postgres";
import { sql } from "@/db/client";
import type { KybStatus } from "./eligibility";

// Broker eligibility to bind a policy comes from the append-only broker_kyb_events table:
// the latest event wins, and no event at all means unknown. Unknown is not permission
// (AGENTS.md: eligibility-dependent actions are blocked while eligibility is unknown), so a
// broker who has never been verified cannot bind anything.
// The rule that turns a status into permission is in ./eligibility.ts.

export type { KybStatus };

export type KybState = {
  status: KybStatus;
  provider: string; // 'seed' until slice B3, then 'stripe_connect'
  providerRef: string | null;
  recordedAt: Date | null;
  isProviderEvidence: boolean; // false while the only event comes from the seed script
};

const NO_EVENT_YET: KybState = {
  status: "unknown",
  provider: "none",
  providerRef: null,
  recordedAt: null,
  isProviderEvidence: false,
};

// The database handle is a parameter whose default is the application pool, like the payment
// functions: production always uses the default, the checks pass the disposable database.
export async function brokerKybState(brokerId: string, database: postgres.Sql = sql): Promise<KybState> {
  const [row] = await database<{ status: KybStatus; provider: string; provider_ref: string | null; recorded_at: Date }[]>`
    select status, provider, provider_ref, recorded_at
      from broker_kyb_events
     where broker_id = ${brokerId}
     order by sequence_number desc
     limit 1
  `;
  if (!row) {
    return NO_EVENT_YET;
  }
  return {
    status: row.status,
    provider: row.provider,
    providerRef: row.provider_ref,
    recordedAt: row.recorded_at,
    // Only a real provider event is evidence. The seed writes a placeholder so the issuance
    // flow can be demonstrated before slice B3 connects Stripe Connect; the interface says so.
    isProviderEvidence: row.provider !== "seed",
  };
}

// Shown next to the status everywhere it appears, until slice B3 replaces the seeded
// placeholder with real Stripe Connect events. AF-02: a placeholder is never labelled live.
export const KYB_NOT_LIVE_LABEL = "KYB: not yet live";
