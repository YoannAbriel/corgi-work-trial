// Proves the one promise of the notification centre: the number and the list say the same thing.
//
// lib/inbox/tasks.ts counts what is waiting for a person, and the sidebar and the "what needs
// you" block put that number on the screen; lib/inbox/read.ts lists the same work item by item
// on /inbox. If the two ever drifted, a badge would send an operator to a screen where the work
// is not there. This check reads both for a batch of brokers and customers and for one user of
// each staff role, and compares them ANCHOR BY ANCHOR: not "do the totals match" but "does each
// count open the very section that holds those items" (review finding F-B13-17). The size of the
// batch, and why it is not everyone, is explained where it is chosen below; how many were left
// out is printed at the end.
//
// WHAT IT WRITES: nothing at all. Every call here is a read, made with the RESTRICTED runtime
// role, so it can be run on the disposable database without adding a single row.
//
// WHERE IT RUNS: the disposable database corgi_test, like the other checks, because that is where
// the seeded and replayed data lives.
//
// WHAT IT NEEDS: the full local environment of `.env.local`, like the other check scripts, and not
// only the two database URLs it reads by name. It imports the application's own readers, and their
// import graph reaches lib/stripe.ts, which refuses to load without STRIPE_SECRET_KEY even though
// nothing here ever calls Stripe (review finding F-B13-19).
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
  // The counting, not the block that draws it: lib/inbox/tasks.ts holds no JSX and imports
  // nothing from components/, so tsx can read it. Importing the component instead reached its
  // illustrations, imported as .webp files for next/image, and this script could not start.
  const { workspaceTasks } = await import("@/lib/inbox/tasks");
  const { workspaceInbox } = await import("@/lib/inbox/read");

  const [{ current_database: databaseName }] = await sql<{ current_database: string }[]>`select current_database()`;
  if (databaseName !== "corgi_test") {
    console.error(`refusing to run: connected to "${databaseName}", expected the disposable database "corgi_test"`);
    process.exit(1);
  }

  // HOW MANY OWNERS ARE COMPARED, and why it is not all of them.
  //
  // Stopping at the first broker with work left seven brokers with change requests uncompared
  // (review finding F-B13-17), so this walks a batch rather than one. It cannot walk everybody:
  // corgi_test has accumulated 434 brokers and 380 customers from every check run ever made, each
  // inbox is a handful of round trips to a database that is not on this machine, and the whole
  // set took more than twenty minutes without finding anything the batch does not find.
  //
  // The batch is the MOST RECENT owners, ordered by their newest policy, because the newest data
  // is what the last check run wrote and therefore where the interesting cases are. How many were
  // left out is printed at the end rather than left to be guessed.
  const OWNERS_PER_ROLE = 25;
  const owners = await sql<{ id: string; display_name: string; role: string; broker_id: string | null; customer_id: string | null }[]>`
    (
      select owner.id, owner.display_name, owner.role, owner.broker_id, owner.customer_id
        from users owner
        left join policies policy on policy.broker_id = owner.broker_id
       where owner.role = 'broker' and owner.broker_id is not null
       group by owner.id
       order by max(policy.created_at) desc nulls last
       limit ${OWNERS_PER_ROLE}
    )
    union all
    (
      select owner.id, owner.display_name, owner.role, owner.broker_id, owner.customer_id
        from users owner
        left join policies policy on policy.customer_id = owner.customer_id
       where owner.role = 'customer' and owner.customer_id is not null
       group by owner.id
       order by max(policy.created_at) desc nulls last
       limit ${OWNERS_PER_ROLE}
    )
  `;
  const [{ brokers: brokerCount, customers: customerCount }] = await sql<{ brokers: number; customers: number }[]>`
    select count(*) filter (where role = 'broker' and broker_id is not null)::int    as brokers,
           count(*) filter (where role = 'customer' and customer_id is not null)::int as customers
      from users
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
    `${ownersChecked} of ${brokerCount + customerCount} brokers and customers compared, the most ` +
      `recent ${OWNERS_PER_ROLE} of each role (largest inbox ${largestOwnerTotal}); ` +
      `${staffChecked} staff compared, one of each role (largest inbox ${largestStaffTotal})`,
  );

  await sql.end();
  console.log(failures === 0 ? "\nAll inbox count checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
