import { sql } from "@/db/client";

// State premium tax rates are effective-dated facts read from an official source, never
// constants in the code. The rate that applies to a policy is the one in force on its
// effective date: the row for that state with the greatest effective_from that is not after
// it. A rate change is a new row, so a policy priced last year keeps being explainable.

export type StateTaxRate = {
  stateCode: string;
  rateBps: number; // 235 = 2.35%
  effectiveFrom: string; // "YYYY-MM-DD"
  sourceUrl: string;
  sourceCheckedOn: string;
  note: string | null;
};

export async function lookupStateTaxRate(stateCode: string, onDate: string): Promise<StateTaxRate | null> {
  const [row] = await sql<
    { state_code: string; rate_bps: number; effective_from: string; source_url: string; source_checked_on: string; note: string | null }[]
  >`
    select state_code,
           rate_bps,
           to_char(effective_from, 'YYYY-MM-DD') as effective_from,
           source_url,
           to_char(source_checked_on, 'YYYY-MM-DD') as source_checked_on,
           note
      from state_tax_rates
     where state_code = ${stateCode}
       and effective_from <= ${onDate}
     order by effective_from desc
     limit 1
  `;
  if (!row) {
    return null;
  }
  return {
    stateCode: row.state_code,
    rateBps: row.rate_bps,
    effectiveFrom: row.effective_from,
    sourceUrl: row.source_url,
    sourceCheckedOn: row.source_checked_on,
    note: row.note,
  };
}

// The states this build can price, for the "new policy" form. One state is modelled in v0.
export async function statesWithTaxRates(): Promise<string[]> {
  const rows = await sql<{ state_code: string }[]>`
    select distinct state_code from state_tax_rates order by state_code
  `;
  return rows.map((row) => row.state_code);
}
