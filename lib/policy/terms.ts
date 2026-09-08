// The shape of the policy terms carried by a policy_event payload, and the only place that
// reads or writes it. Amounts are integer cents; the reader refuses anything that is not a
// safe integer, so a payload that ever came back as a fraction stops the flow instead of
// silently rounding.

export type PolicyTerms = {
  stateCode: string;
  termStart: string; // "YYYY-MM-DD", the policy effective date
  termEnd: string; // "YYYY-MM-DD", computed by lib/money/dates.ts
  annualPremiumCents: number;
  taxRateBps: number;
  taxCents: number;
  feeCents: number;
  totalChargeCents: number;
  perOccurrenceLimitCents: number;
  aggregateLimitCents: number;
};

// Written with the same snake_case names as the SQL columns, so a row read in psql and a
// payload read in the application look alike.
export function policyTermsToPayload(terms: PolicyTerms): Record<string, string | number> {
  return {
    state_code: terms.stateCode,
    term_start: terms.termStart,
    term_end: terms.termEnd,
    annual_premium_cents: terms.annualPremiumCents,
    tax_rate_bps: terms.taxRateBps,
    tax_cents: terms.taxCents,
    fee_cents: terms.feeCents,
    total_charge_cents: terms.totalChargeCents,
    per_occurrence_limit_cents: terms.perOccurrenceLimitCents,
    aggregate_limit_cents: terms.aggregateLimitCents,
  };
}

export function policyTermsFromPayload(payload: unknown): PolicyTerms {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("policy event payload is not an object");
  }
  const fields = payload as Record<string, unknown>;
  return {
    stateCode: readText(fields, "state_code"),
    termStart: readText(fields, "term_start"),
    termEnd: readText(fields, "term_end"),
    annualPremiumCents: readWholeNumber(fields, "annual_premium_cents"),
    taxRateBps: readWholeNumber(fields, "tax_rate_bps"),
    taxCents: readWholeNumber(fields, "tax_cents"),
    feeCents: readWholeNumber(fields, "fee_cents"),
    totalChargeCents: readWholeNumber(fields, "total_charge_cents"),
    perOccurrenceLimitCents: readWholeNumber(fields, "per_occurrence_limit_cents"),
    aggregateLimitCents: readWholeNumber(fields, "aggregate_limit_cents"),
  };
}

function readText(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`policy event payload field ${key} is missing or not text`);
  }
  return value;
}

function readWholeNumber(fields: Record<string, unknown>, key: string): number {
  const value = fields[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`policy event payload field ${key} is not a whole non-negative number: ${String(value)}`);
  }
  return value;
}
