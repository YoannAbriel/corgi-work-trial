// Read-only re-read of the day's figures on the deployed revision. node reread.mjs <outdir>
// Fetches the pages as ops, converts them to text and checks that each expected string is
// present. Prints one line per figure: agree or DISAGREE. Writes the page texts to <outdir>.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const out = process.argv[2] ?? join(HERE, "reread");
mkdirSync(out, { recursive: true });

const P1707 = "/policies/3c3697b7-33f8-45a4-beaf-5a1892fc9483";
const P1274 = "/policies/104d2966-be96-4c36-9956-caf0762f8b15";

function text(path, name) {
  const html = join(out, `${name}.html`);
  execFileSync("node", [join(HERE, "live.mjs"), "get", "ops@example.com", path, html], { stdio: "pipe" });
  const body = execFileSync("node", [join(HERE, "text.mjs"), html], { encoding: "utf8" });
  writeFileSync(join(out, `${name}.txt`), body);
  return body;
}

const health = JSON.parse(execFileSync("curl", ["-s", "https://corgi-work-trial-iota.vercel.app/api/health"], { encoding: "utf8" }));
console.log(`revision ${health.revision} at ${health.databaseTime}`);

const pages = {
  p1707: text(`${P1707}?view=money`, "cgp-01707-money"),
  p1707overview: text(P1707, "cgp-01707-overview"),
  p1707claims: text(`${P1707}?view=claims`, "cgp-01707-claims"),
  p1707endorsements: text(`${P1707}?view=endorsements`, "cgp-01707-endorsements"),
  p1274: text(`${P1274}?view=money`, "cgp-01274-money"),
  p1274overview: text(P1274, "cgp-01274-overview"),
  p1274claims: text(`${P1274}?view=claims`, "cgp-01274-claims"),
  recon: text("/ops/reconciliation", "reconciliation"),
  statements: text("/ops/statements", "statements"),
  rev6: text("/statements/8df46119-a401-41a6-b8c2-c093a7c1ba02", "statement-redwood-2026-09-rev6"),
  rev4: text("/statements/c602abcf-7113-4256-a8c5-711778cf4000", "statement-redwood-2026-09-rev4"),
  asof0915: text(`${P1707}?view=timeline&asOf=2026-09-15`, "cgp-01707-asof-2026-09-15"),
  asof0925: text(`${P1707}?view=timeline&asOf=2026-09-25`, "cgp-01707-asof-2026-09-25"),
  asof1005: text(`${P1707}?view=timeline&asOf=2026-10-05`, "cgp-01707-asof-2026-10-05"),
  clm214: text("/ops/claims/65fca884-2960-40f3-ae0f-0a10fabbfa0c", "clm-00214-overview"),
  clm214pay: text("/ops/claims/65fca884-2960-40f3-ae0f-0a10fabbfa0c?view=payments", "clm-00214-payments"),
  brokers: text("/ops/brokers", "ops-brokers"),
  p1709: text("/policies/f8ed1db7-2c99-40b7-8809-daf3c606865d?view=money", "cgp-01709-money"),
};

// [page, label, expected substring]
const checks = [
  // integration.md 4.1, CGP-01707 (figures that survive the day's events are checked on the journal lines)
  ["p1707", "CGP-01707 written premium at issuance 120000", "premium_written | 2026-09-08 | 2026-09-08 18:57:00 | Cr Written premium not yet earned (owed back on cancel) 120000"],
  ["p1707overview", "CGP-01707 tax at issuance 2820", "State premium tax collected, owed to the state 2820"],
  ["p1707overview", "CGP-01707 fee 2500", "Flat policy fee, fully earned at issuance 2500"],
  ["p1707", "CGP-01707 charge at issuance 125320", "premium_collected | 2026-09-08 | 2026-09-08 18:57:00 | Dr Cash held at Stripe (gross of Stripe fees) 125320"],
  ["p1707", "CGP-01707 commission at issuance 18000", "commission_earned | 2026-09-08 | 2026-09-08 18:57:00 | Cr Commission owed to brokers, reduced by clawbacks 18000"],
  ["p1707endorsements", "CGP-01707 first endorsement re-booked 351 of 365 days", "351 of 365 days remain from 2026-09-22"],
  ["p1707endorsements", "CGP-01707 first endorsement prorated premium after correction $1,153.97", "$1,153.97"],
  ["p1707", "CGP-01707 endorsement delta collected 112724", "endorsement_premium_collected | 2026-09-09 | 2026-09-09 06:34:34 | Dr Cash held at Stripe (gross of Stripe fees) 112724"],
  ["p1707", "CGP-01707 endorsement commission 16520", "reduced by clawbacks 16520"],
  ["p1707", "CGP-01707 Stripe reference of the delta", "pi_3UDf5YK6R3v50tIy1GkJdCCi"],
  ["p1707", "CGP-01707 correction difference collected 5384", "Dr Cash held at Stripe (gross of Stripe fees) 5384"],
  ["p1707", "CGP-01707 correction commission 789", "reduced by clawbacks 789"],
  ["p1707", "CGP-01707 second endorsement collected 28769", "Dr Cash held at Stripe (gross of Stripe fees) 28769"],
  ["p1707", "CGP-01707 cash collected $2,721.97", "125320 + 112724 + 5384 + 28769 | $2,721.97"],
  ["p1707", "CGP-01707 refunded $2,301.62", "28769 + 83285 + 112724 + 5384 | $2,301.62"],
  ["p1707", "CGP-01707 commission payable after clawback $57.94", "$57.94"],
  ["p1707", "CGP-01707 unearned premium after cancellation $0.00", "Unearned premium, credits minus debits | 120000 + 115397 + 28109 - 38629 - 81374 - 5260 - 28108 - 110135 | $0.00"],
  ["p1707", "CGP-01707 refund re_3UDrw9 completed", "re_3UDrw9K6R3v50tIy1ffy43I1"],
  ["p1707", "CGP-01707 refund re_3UDUCU completed", "re_3UDUCUK6R3v50tIy0gKOTYl7"],
  ["p1707", "CGP-01707 refund re_3UDf5Y completed", "re_3UDf5YK6R3v50tIy1TVf1Llk"],
  ["p1707", "CGP-01707 refund re_3UDrW1 completed", "re_3UDrW1K6R3v50tIy1qNn3zvG"],
  ["p1707overview", "CGP-01707 status cancelled", "cancelled"],
  ["p1707claims", "CLM-00213 open, reserve $2,000.00, paid $0.00", "CLM-00213Bay Area Fabrication LLC | 2026-09-09 | open | $2,000.00 | $0.00 | $2,000.00"],
  ["asof0915", "as of 2026-09-15 annual premium $1,200.00", "Annual premium\n$1,200.00"],
  ["asof0925", "as of 2026-09-25 annual premium $2,400.00", "Annual premium\n$2,400.00"],
  ["asof1005", "as of 2026-10-05 annual premium $2,700.00", "Annual premium\n$2,700.00"],
  // integration.md 4.1, CGP-01274
  ["p1274", "CGP-01274 written premium 231200", "Cr Written premium not yet earned (owed back on cancel) 231200"],
  ["p1274", "CGP-01274 charge at issuance 239133", "Dr Cash held at Stripe (gross of Stripe fees) 239133"],
  ["p1274", "CGP-01274 earned to the cancellation 27870", "27870"],
  ["p1274", "CGP-01274 unearned refunded 203330", "203330"],
  ["p1274", "CGP-01274 tax refunded 4779", "4779"],
  ["p1274", "CGP-01274 total refund 208109", "Cr Cash held at Stripe (gross of Stripe fees) 208109"],
  ["p1274", "CGP-01274 clawback 30499", "reduced by clawbacks 30499"],
  ["p1274", "CGP-01274 commission payable net $41.81", "$41.81"],
  ["p1274", "CGP-01274 Stripe refund reference", "re_3UDN8aK6R3v50tIy0J6CmRy3"],
  ["p1274claims", "CGP-01274 claim paid $1,200.00 and reserve $3,800.00", "$3,800.00"],
  ["p1274claims", "CGP-01274 incurred $5,000.00", "$5,000.00"],
  // today's board and statements
  ["recon", "board: 4 breaks to act on, 32 probes (or more probes if a check run planted one)", "breaks to act on"],
  // The statements list was redesigned in interface batch 2 (decision 64): one row per broker and
  // month, earlier revisions folded newest first, so the old pipe-separated literals of these two
  // lines no longer appear. The figures did not move; only the markup did. Updated 2026-09-10.
  ["statements", "Redwood 2026-09 revision 6 at $437.45", "Revision 6"],
  ["statements", "Redwood 2026-09 revision 6 still reads $437.45", "$437.45"],
  ["rev6", "revision 6 hash", "5c991578feb94844d3b1fb9de8d04010d3bd4788134902953dc0c900b41e84d8"],
  ["rev6", "revision 6 net due", "| Net due to the broker | 121750 - 78005 + 0 | $437.45"],
  ["rev4", "revision 4 hash", "7eddb01ae791314713dc57eb69a11d07bbafc1f4926028417391d6af0919c78c"],
  ["rev4", "revision 4 net due", "| Net due to the broker | 120961 - 78005 + 0 | $429.56"],
  // LIVE-3 and LIVE-10
  ["brokers", "Sierra Crest approved, EIN ending 0000", "Sierra Crest Brokerage LLC, EIN ending 0000 | 15.00% | approved"],
  ["brokers", "Harbor Point failed", "failedverification_failed_tax_id_match"],
  ["p1709", "CGP-01709 collected 1230700", "Dr Cash held at Stripe (gross of Stripe fees) 1230700"],
  ["p1709", "CGP-01709 commission 180000", "reduced by clawbacks 180000"],
  ["clm214", "CLM-00214 paid $800.00", "| Paid: every payment sent on the rail, minus anything the bank returned | 80000 | $800.00"],
  ["clm214", "CLM-00214 reserve $1,700.00", "| 170000 | $1,700.00"],
  ["clm214", "CLM-00214 incurred = 80000 + 170000", "| Incurred = paid + reserve | 80000 + 170000 | $2,500.00"],
  ["clm214pay", "CLM-00214 A returned", "sim_tr_edbd330eb019836c1a9704e8afac5339"],
  ["clm214pay", "CLM-00214 B sent", "sim_tr_127e3e7e412f63ef0f8a0ca1a91d7bbf"],
  ["clm214pay", "CLM-00214 D sent", "sim_tr_64acae2d7f00dfdcdfd7eac9ef357561"],
];

let disagreements = 0;
for (const [page, label, expected] of checks) {
  const ok = pages[page].includes(expected);
  if (!ok) disagreements += 1;
  console.log(`${ok ? "agree    " : "DISAGREE "} ${label}`);
}
const boardLine = pages.recon.split("\n").find((line) => /\d+ breaks to act on/.test(line));
console.log(`board line: ${boardLine ?? "not found"}`);
console.log(`${checks.length} checks, ${disagreements} disagreements`);
