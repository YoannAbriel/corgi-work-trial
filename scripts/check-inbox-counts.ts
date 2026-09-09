// Proves the one promise of the notification centre: the number and the list say the same thing.
//
// components/what-needs-you.tsx counts what is waiting for a person and puts the number on the
// sidebar; lib/inbox/read.ts lists the same work item by item on /inbox. If the two ever drifted,
// a badge would send an operator to a screen where the work is not there. This check reads both
// for every broker and customer of the database, and for one user of each staff role, and
// compares them ANCHOR BY ANCHOR: not "do the totals match" but "does each count open the very
// section that holds those items" (review finding F-B13-17).
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

  // Every broker and every customer: they are cheap to read, and stopping at the first one with
  // work left seven brokers uncompared on this database (review finding F-B13-17).
  const owners = await sql<{ id: string; display_name: string; role: string; broker_id: string | null; customer_id: string | null }[]>`
    select id, display_name, role, broker_id, customer_id
      from users
     where (role = 'broker' and broker_id is not null)
        or (role = 'customer' and customer_id is not null)
     order by role, display_name
  `;
  // One of each staff role: the two see different lists, because binding a paid policy and
  // applying a paid endorsement are staff operations work and never an approver's.
  const staff = await sql<{ id: string; display_name: string; role: string; broker_id: string | null; customer_id: string | null }[]>`
    select distinct on (role) id, display_name, role, broker_id, customer_id
      from users
     where role in ('staff_ops', 'staff_approver')
     order by role, display_name
  `;

  let ownersChecked = 0;
  let staffChecked = 0;
  let largestOwnerTotal = 0;
  let largestStaffTotal = 0;

  for (const row of [...owners, ...staff]) {
    const user = {
      role: row.role as "broker" | "customer" | "staff_ops" | "staff_approver",
      brokerId: row.broker_id,
      customerId: row.customer_id,
    };
    const [tasks, inbox] = await Promise.all([workspaceTasks(user), workspaceInbox(user)]);

    // ANCHOR BY ANCHOR, not sidebar section by sidebar section. Folding the ten anchors onto the
    // four sidebar names made the two sides equal by construction whenever the totals were, which
    // is why this check reported PASS on the very data where F-B13-15 was visible on screen.
    const countedByAnchor = new Map<string, number>();
    for (const task of tasks) {
      countedByAnchor.set(task.anchor, (countedByAnchor.get(task.anchor) ?? 0) + task.count);
    }
    const listedByAnchor = new Map<string, number>();
    for (const section of inbox.sections) {
      if (listedByAnchor.has(section.anchor)) {
        // Two panels with one id: the browser would send #policies to the first of them.
        report(`${row.role} ${row.display_name}: one anchor per section`, false, `#${section.anchor} is used twice`);
      }
      listedByAnchor.set(section.anchor, (listedByAnchor.get(section.anchor) ?? 0) + section.items.length);
    }

    // A policy the readers refuse to answer for is counted by neither side in the same way:
    // workspaceTasks catches the failure and returns no task at all, while the inbox lists what
    // it could read and names the policy it could not. Comparing those two is comparing nothing,
    // so the user is reported as skipped, with the policies that caused it.
    if (inbox.unreadablePolicies.length > 0) {
      console.log(
        `SKIP  ${row.role} ${row.display_name}: ${inbox.unreadablePolicies.length} policy or policies whose stored ` +
          `figures were refused (${inbox.unreadablePolicies.map((policy) => policy.policyNumber).join(", ")}); ` +
          `the badge shows nothing for this user while the inbox lists ${inbox.totalWaiting}`,
      );
      continue;
    }

    // Only the anchors a task named are compared for equality: a section nobody counted (an empty
    // panel, or one the sidebar does not badge) is listed with its number and is not a failure.
    const named = [...countedByAnchor.keys()];
    const detail = named
      .map((anchor) => `#${anchor} ${countedByAnchor.get(anchor) ?? 0}/${listedByAnchor.get(anchor) ?? 0}`)
      .join(", ");
    const agree = named.every((anchor) => (countedByAnchor.get(anchor) ?? 0) === (listedByAnchor.get(anchor) ?? 0));
    const counted = tasks.reduce((total, task) => total + task.count, 0);

    report(
      `${row.role} ${row.display_name}: each count opens a section holding exactly those items`,
      agree && counted === inbox.totalWaiting,
      `${counted} counted, ${inbox.totalWaiting} listed${detail ? `; ${detail}` : "; nothing waiting"}`,
    );

    if (row.role === "broker" || row.role === "customer") {
      ownersChecked += 1;
      largestOwnerTotal = Math.max(largestOwnerTotal, inbox.totalWaiting);
    }
    if (row.role === "staff_ops" || row.role === "staff_approver") {
      staffChecked += 1;
      largestStaffTotal = Math.max(largestStaffTotal, inbox.totalWaiting);
    }
  }

  // A comparison of two zeros proves nothing, so say out loud whether any real work was compared.
  report(
    "at least one broker or customer and one staff user had work waiting",
    ownersChecked > 0 && staffChecked > 0 && largestOwnerTotal > 0 && largestStaffTotal > 0,
    `${ownersChecked} brokers and customers compared (largest inbox ${largestOwnerTotal}), ` +
      `${staffChecked} staff compared (largest inbox ${largestStaffTotal})`,
  );

  await sql.end();
  console.log(failures === 0 ? "\nAll inbox count checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
