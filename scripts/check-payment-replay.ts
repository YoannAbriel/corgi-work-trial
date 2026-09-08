import postgres from "postgres";

// Proves, against a real database, the property the whole payment flow depends on:
//
//   delivering the same successful payment twice posts the money ONCE.
//
// It runs the production function (lib/payments/collection.ts) twice on the same money
// operation and then counts what is in the journal. The second call must come back as
// "already_posted", because the journal's unique index refuses the second set of entries.
//
// It commits rows, so it refuses to run anywhere but the disposable database corgi_test:
// financial rows can never be deleted (AF-03), and the trial ledger must stay clean.
// Run with: npm run check:payment-replay

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

// Two connections, as in production: the owner creates the fixtures (a broker cannot be
// inserted by the application), and the runtime role runs the payment code, so the check also
// proves that posting works with the restricted privileges the deployed app actually has.
const ownerUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL_TEST_APP;
if (!ownerUrl || !runtimeUrl) {
  console.error("DATABASE_URL_TEST and DATABASE_URL_TEST_APP must be set: this check only runs on the disposable database");
  process.exit(1);
}

// The recited example (DECISIONS.md): $1,200 premium, California 2.35% = 2820, $25 fee.
const ANNUAL_PREMIUM_CENTS = 120000;
const TAX_CENTS = 2820;
const FEE_CENTS = 2500;
const TOTAL_CHARGE_CENTS = 125320;
const COMMISSION_CENTS = 18000; // 15% of the collected premium
const TERM_START = "2028-03-01";

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

const owner = postgres(ownerUrl, { max: 2, prepare: false });
const runtime = postgres(runtimeUrl, { max: 2, prepare: false });

async function main() {
  // Imported here rather than at the top of the file: lib/payments/collection.ts opens the
  // application connection pool as soon as it is loaded, which needs .env.local read first.
  const { recordSuccessfulPayment } = await import("@/lib/payments/collection");

  const [{ current_database: databaseName }] = await owner<{ current_database: string }[]>`
    select current_database()
  `;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  // A fresh policy, quoted and awaiting payment, exactly as the application would leave it.
  const { policyId, operationId } = await createPolicyAwaitingPayment();

  const payment = {
    operationId,
    paymentIntentId: `pi_replay_check_${operationId.slice(0, 8)}`,
    amountReceivedCents: TOTAL_CHARGE_CENTS,
    paidOn: TERM_START,
  };

  const first = await recordSuccessfulPayment(payment, runtime);
  report("the first delivery posts the money", first.kind === "posted", `outcome: ${first.kind}`);

  const second = await recordSuccessfulPayment(payment, runtime);
  report(
    "the second delivery of the same payment is recognised as already posted",
    second.kind === "already_posted",
    `outcome: ${second.kind}`,
  );

  // What is actually in the journal after two deliveries.
  const entries = await owner<{ entry_type: string; count: string }[]>`
    select entry_type, count(*)::text as count
      from journal_entries
     where source_kind = 'money_operation' and source_id = ${operationId}
     group by entry_type
     order by entry_type
  `;
  const byType = new Map(entries.map((row) => [row.entry_type, Number(row.count)]));
  report(
    "exactly four entries exist, one of each type",
    entries.length === 4 && entries.every((row) => row.count === "1"),
    entries.map((row) => `${row.entry_type} x${row.count}`).join(", ") || "no entry",
  );
  report(
    "the entry types are the four issuance and collection entries",
    ["premium_written", "tax_and_fee_billed", "premium_collected", "commission_earned"].every((type) =>
      byType.has(type),
    ),
    [...byType.keys()].join(", "),
  );

  // The amounts, account by account, must be the recited ones.
  const balances = await owner<{ account_id: string; debit: string; credit: string }[]>`
    select line.account_id,
           coalesce(sum(line.debit_cents), 0)::text  as debit,
           coalesce(sum(line.credit_cents), 0)::text as credit
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.source_kind = 'money_operation' and entry.source_id = ${operationId}
     group by line.account_id
     order by line.account_id
  `;
  const amountOn = (accountId: string, side: "debit" | "credit") =>
    Number(balances.find((row) => row.account_id === accountId)?.[side] ?? "-1");

  report("cash at Stripe is debited once with the whole charge", amountOn("cash_stripe", "debit") === TOTAL_CHARGE_CENTS, `${amountOn("cash_stripe", "debit")} cents`);
  report("unearned premium is credited with the written premium", amountOn("unearned_premium", "credit") === ANNUAL_PREMIUM_CENTS, `${amountOn("unearned_premium", "credit")} cents`);
  report("the state premium tax is separated from the premium", amountOn("premium_tax_payable", "credit") === TAX_CENTS, `${amountOn("premium_tax_payable", "credit")} cents`);
  report("the policy fee is income at issuance", amountOn("fee_income", "credit") === FEE_CENTS, `${amountOn("fee_income", "credit")} cents`);
  report("the broker commission is 15% of the collected premium", amountOn("commission_payable", "credit") === COMMISSION_CENTS, `${amountOn("commission_payable", "credit")} cents`);
  report(
    "the receivable opened by the billing entries is fully cleared",
    amountOn("premium_receivable", "debit") === TOTAL_CHARGE_CENTS && amountOn("premium_receivable", "credit") === TOTAL_CHARGE_CENTS,
    `debit ${amountOn("premium_receivable", "debit")} = credit ${amountOn("premium_receivable", "credit")}`,
  );

  const [totals] = await owner<{ debit: string; credit: string }[]>`
    select coalesce(sum(line.debit_cents), 0)::text as debit, coalesce(sum(line.credit_cents), 0)::text as credit
      from journal_lines line
      join journal_entries entry on entry.id = line.entry_id
     where entry.source_kind = 'money_operation' and entry.source_id = ${operationId}
  `;
  report("the four entries balance", totals.debit === totals.credit, `debits ${totals.debit} = credits ${totals.credit}`);

  // The policy is bound exactly once, whatever the number of deliveries.
  const issuances = await owner<{ count: string }[]>`
    select count(*)::text as count from policy_events where policy_id = ${policyId} and event_type = 'issued'
  `;
  report("the policy was issued exactly once", issuances[0].count === "1", `${issuances[0].count} issuance event(s)`);

  const [current] = await owner<{ status: string }[]>`
    select status from policy_current where policy_id = ${policyId}
  `;
  report("the policy shows as bound", current.status === "bound", `status: ${current.status}`);

  const successes = await owner<{ count: string }[]>`
    select count(*)::text as count from money_operation_events where operation_id = ${operationId} and status = 'succeeded'
  `;
  report("one success event was appended, not two", successes[0].count === "1", `${successes[0].count} succeeded event(s)`);

  // A payment whose amount is not the amount we asked for is refused instead of posted.
  const wrongAmount = await recordSuccessfulPayment({ ...payment, amountReceivedCents: 999 }, runtime);
  report(
    "a payment for another amount is refused, not journaled",
    wrongAmount.kind === "refused",
    wrongAmount.kind === "refused" ? wrongAmount.reason : wrongAmount.kind,
  );

  await owner.end();
  await runtime.end();
  process.exit(failures === 0 ? 0 : 1);
}

// Builds the same rows the application writes before a payment: a broker, a customer, a
// policy, its immutable quote, and a money operation awaiting the provider's answer.
async function createPolicyAwaitingPayment(): Promise<{ policyId: string; operationId: string }> {
  return owner.begin(async (transaction) => {
    const [broker] = await transaction<{ id: string }[]>`
      insert into brokers (name, commission_rate_bps) values ('Replay check broker', 1500) returning id
    `;
    const [customer] = await transaction<{ id: string }[]>`
      insert into customers (name, email)
      values ('Replay check customer', 'replay-check-' || gen_random_uuid()::text || '@example.invalid')
      returning id
    `;
    const [policy] = await transaction<{ id: string }[]>`
      insert into policies (broker_id, customer_id, state_code) values (${broker.id}, ${customer.id}, 'CA') returning id
    `;
    await transaction`
      insert into policy_events (policy_id, event_type, effective_at, payload)
      values (${policy.id}, 'quoted', ${TERM_START}, ${transaction.json({
        state_code: "CA",
        term_start: TERM_START,
        term_end: "2029-03-01",
        annual_premium_cents: ANNUAL_PREMIUM_CENTS,
        tax_rate_bps: 235,
        tax_cents: TAX_CENTS,
        fee_cents: FEE_CENTS,
        total_charge_cents: TOTAL_CHARGE_CENTS,
        per_occurrence_limit_cents: 100000000,
        aggregate_limit_cents: 200000000,
      })})
    `;
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations (kind, provider, amount_cents, policy_id, idempotency_key)
      values ('stripe_checkout', 'stripe', ${TOTAL_CHARGE_CENTS}, ${policy.id},
              'policy-checkout:' || ${policy.id})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status) values (${operation.id}, 'requested')
    `;
    return { policyId: policy.id, operationId: operation.id };
  });
}

main().catch(async (error) => {
  console.error("check failed to run:", error instanceof Error ? error.message : error);
  await owner.end();
  await runtime.end();
  process.exit(1);
});
