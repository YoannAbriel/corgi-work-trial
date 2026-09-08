import postgres from "postgres";

// Seed from zero: one broker, one customer, four demo users, one state premium tax rate and
// one broker KYB status. Run with: npm run seed   (add -- --database=test for the test database)
//
// It runs as the OWNER connection because the runtime role cannot insert everything it needs,
// and it REFUSES to run when any of the tables it fills already holds a row. Rewriting or
// clearing existing rows is impossible by design (AF-03): the append-only triggers and the
// missing TRUNCATE privilege would refuse it, so the only safe seed is a seed from zero.
//
// Nothing here is a secret: the demo password lives in DEMO_PASSWORD and is never stored.

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

const useTestDatabase = process.argv.includes("--database=test");
const ownerConnectionString = useTestDatabase ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
if (!ownerConnectionString) {
  console.error(useTestDatabase ? "DATABASE_URL_TEST is not set" : "DATABASE_URL is not set");
  process.exit(1);
}
if (!process.env.DEMO_PASSWORD) {
  console.error("DEMO_PASSWORD is not set: the demo users would exist but nobody could sign in");
  process.exit(1);
}

// The tables this script fills, plus the money tables that must be empty for a from-zero seed.
// `accounts` is deliberately absent: the chart of accounts is created by migration 0001.
const TABLES_THAT_MUST_BE_EMPTY = [
  "brokers",
  "customers",
  "users",
  "state_tax_rates",
  "broker_kyb_events",
  "policies",
  "policy_events",
  "money_operations",
  "money_operation_events",
  "journal_entries",
  "journal_lines",
];

// California, the one state this build prices. Decided by Yoann on 2026-09-08 from the
// official source below; the rate is never invented and never hard-coded in the application.
const CALIFORNIA_PREMIUM_TAX = {
  stateCode: "CA",
  rateBps: 235, // 2.35% of gross premium on admitted property and casualty business
  effectiveFrom: "1986-01-01",
  sourceUrl:
    "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CONS&sectionNum=SEC.%2028.&article=XIII",
  sourceCheckedOn: "2026-09-08",
  note:
    "Cal. Const. art. XIII s. 28(d): 2.35 percent; effective_from derived from RTC 12202 (1982 to 1985 were 2.33 percent), not stated verbatim",
};

const sql = postgres(ownerConnectionString, { max: 1, prepare: false });

async function main() {
  const occupied: string[] = [];
  for (const table of TABLES_THAT_MUST_BE_EMPTY) {
    const [row] = await sql<{ count: string }[]>`select count(*)::text as count from ${sql(table)}`;
    if (row.count !== "0") {
      occupied.push(`${table}: ${row.count} row(s)`);
    }
  }
  if (occupied.length > 0) {
    console.error("This database already holds data, so a seed from zero is refused:");
    for (const line of occupied) {
      console.error(`  ${line}`);
    }
    console.error("Financial rows can never be deleted (AF-03). Use an empty database.");
    process.exit(1);
  }

  await sql.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps)
      values ('Redwood Commercial Brokers', 1500)
      returning id
    `;

    const [customer] = await transaction<{ id: string }[]>`
      insert into customers (name, email)
      values ('Bay Area Fabrication LLC', 'customer@example.com')
      returning id
    `;

    await transaction`
      insert into users (email, display_name, role, broker_id, customer_id) values
        ('broker@example.com',   'Dana Ruiz, broker',        'broker',         ${broker.id}, null),
        ('customer@example.com', 'Bay Area Fabrication LLC', 'customer',       null,         ${customer.id}),
        ('ops@example.com',      'Sam Patel, operations',    'staff_ops',      null,         null),
        ('approver@example.com', 'Alex Kim, approver',       'staff_approver', null,         null)
    `;

    await transaction`
      insert into state_tax_rates (state_code, rate_bps, effective_from, source_url, source_checked_on, note)
      values (${CALIFORNIA_PREMIUM_TAX.stateCode}, ${CALIFORNIA_PREMIUM_TAX.rateBps},
              ${CALIFORNIA_PREMIUM_TAX.effectiveFrom}, ${CALIFORNIA_PREMIUM_TAX.sourceUrl},
              ${CALIFORNIA_PREMIUM_TAX.sourceCheckedOn}, ${CALIFORNIA_PREMIUM_TAX.note})
    `;

    // The broker's eligibility. This is NOT provider evidence: slice B3 replaces it with real
    // Stripe Connect events. The payload says so, and the interface repeats it next to the
    // status, so nobody can mistake a placeholder for a completed verification (AF-02).
    await transaction`
      insert into broker_kyb_events (broker_id, provider, status, payload)
      values (${broker.id}, 'seed', 'approved',
              ${transaction.json({
                note: "development placeholder until slice B3 wires Stripe Connect; not provider evidence",
              })})
    `;

    console.log(`broker              Redwood Commercial Brokers (15.00% commission) ${broker.id}`);
    console.log(`customer            Bay Area Fabrication LLC ${customer.id}`);
    console.log("users               broker@example.com, customer@example.com, ops@example.com, approver@example.com");
    console.log("                    password: the value of DEMO_PASSWORD (not printed)");
    console.log(`state tax rate      CA 235 bps from ${CALIFORNIA_PREMIUM_TAX.effectiveFrom}`);
    console.log("broker KYB          approved by provider 'seed' (development placeholder, not provider evidence)");
  });
}

main()
  .then(() => sql.end())
  .catch(async (error) => {
    console.error("seed failed:", error instanceof Error ? error.message : error);
    await sql.end();
    process.exit(1);
  });
