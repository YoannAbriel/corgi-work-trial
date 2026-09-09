// Proves the one promise of the notification centre: the number and the list say the same thing.
//
// components/what-needs-you.tsx counts what is waiting for a person and puts the number on the
// sidebar; lib/inbox/read.ts lists the same work item by item on /inbox. If the two ever drifted,
// a badge would send an operator to a screen where the work is not there. This check reads both
// for every broker and every staff user of the database and compares them, section by section.
//
// WHAT IT WRITES: nothing at all. Every call here is a read, made with the RESTRICTED runtime
// role, so it can be run on the disposable database without adding a single row.
//
// WHERE IT RUNS: the disposable database corgi_test, like the other checks, because that is where
// the seeded and replayed data lives.
//
// Run with: npm run check:inbox-counts

// This file is a module of its own (its application imports are dynamic, after the connection
// string is redirected below), so its helpers do not collide with the other scripts'.
export {};

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the environment
}

const runtimeUrl = process.env.DATABASE_URL_TEST_APP;
if (!runtimeUrl) {
  console.error("DATABASE_URL_TEST_APP must be set: this check only runs on the disposable database");
  process.exit(1);
}
// The application modules connect to DATABASE_URL_APP; point them at the disposable database.
process.env.DATABASE_URL_APP = runtimeUrl;

// Which sidebar section each inbox section belongs to. The sidebar knows four names; the inbox
// splits some of them into several lists, and this is where the two vocabularies meet.
const SIDEBAR_SECTION_OF_ANCHOR: Record<string, string> = {
  approvals: "approvals",
  policies: "policies",
  "endorsement-deltas": "policies",
  "correction-differences": "policies",
  "waiting-for-the-customer": "policies",
  corrections: "policies",
  endorsements: "policies",
  claims: "claims",
  reconciliation: "reconciliation",
};

let failures = 0;
function report(name: string, passed: boolean, detail: string) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}  (${detail})`);
  if (!passed) failures += 1;
}

async function main() {
  const { sql } = await import("@/db/client");
  const { workspaceTasks } = await import("@/components/what-needs-you");
  const { workspaceInbox } = await import("@/lib/inbox/read");

  const [{ current_database: databaseName }] = await sql<{ current_database: string }[]>`select current_database()`;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  const users = await sql<{ id: string; display_name: string; role: string; broker_id: string | null; customer_id: string | null }[]>`
    select id, display_name, role, broker_id, customer_id
      from users
     where role in ('broker', 'customer', 'staff_ops', 'staff_approver')
     order by role, display_name
  `;

  let brokersChecked = 0;
  let staffChecked = 0;
  let largestBrokerTotal = 0;
  let largestStaffTotal = 0;

  for (const row of users) {
    const user = { role: row.role as "broker" | "customer" | "staff_ops" | "staff_approver", brokerId: row.broker_id, customerId: row.customer_id };
    const [tasks, inbox] = await Promise.all([workspaceTasks(user), workspaceInbox(user)]);

    const countedBySection = new Map<string, number>();
    for (const task of tasks) {
      countedBySection.set(task.section, (countedBySection.get(task.section) ?? 0) + task.count);
    }
    const listedBySection = new Map<string, number>();
    for (const section of inbox.sections) {
      const sidebarSection = SIDEBAR_SECTION_OF_ANCHOR[section.anchor];
      if (!sidebarSection) {
        report(`${row.display_name}: unknown inbox anchor`, false, section.anchor);
        continue;
      }
      listedBySection.set(sidebarSection, (listedBySection.get(sidebarSection) ?? 0) + section.items.length);
    }

    // A policy the readers refuse to answer for is counted by neither side in the same way:
    // workspaceTasks catches the failure and returns no task at all, while the inbox lists what
    // it could read and names the policy it could not. Comparing those two is comparing nothing,
    // so the user is reported as skipped, with the policies that caused it.
    if (inbox.unreadablePolicyNumbers.length > 0) {
      console.log(
        `SKIP  ${row.role} ${row.display_name}: ${inbox.unreadablePolicyNumbers.length} unreadable policy or policies ` +
          `(${inbox.unreadablePolicyNumbers.join(", ")}); the badge shows nothing for this user while the inbox lists ${inbox.totalWaiting}`,
      );
      continue;
    }

    const sections = new Set([...countedBySection.keys(), ...listedBySection.keys()]);
    const detail = [...sections]
      .map((section) => `${section} ${countedBySection.get(section) ?? 0}/${listedBySection.get(section) ?? 0}`)
      .join(", ");
    const agree = [...sections].every((section) => (countedBySection.get(section) ?? 0) === (listedBySection.get(section) ?? 0));
    const counted = tasks.reduce((total, task) => total + task.count, 0);

    report(
      `${row.role} ${row.display_name}: badge counts equal inbox lines`,
      agree && counted === inbox.totalWaiting,
      `${counted} counted, ${inbox.totalWaiting} listed${detail ? `; ${detail}` : "; nothing waiting"}`,
    );

    if (row.role === "broker") {
      brokersChecked += 1;
      largestBrokerTotal = Math.max(largestBrokerTotal, inbox.totalWaiting);
    }
    if (row.role === "staff_ops" || row.role === "staff_approver") {
      staffChecked += 1;
      largestStaffTotal = Math.max(largestStaffTotal, inbox.totalWaiting);
    }
  }

  // A comparison of two zeros proves nothing, so say out loud whether any real work was compared.
  report(
    "at least one broker and one staff user had work waiting",
    brokersChecked > 0 && staffChecked > 0 && largestBrokerTotal > 0 && largestStaffTotal > 0,
    `${brokersChecked} brokers (largest inbox ${largestBrokerTotal}), ${staffChecked} staff (largest inbox ${largestStaffTotal})`,
  );

  await sql.end();
  console.log(failures === 0 ? "\nAll inbox count checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
