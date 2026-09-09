// The demo accounts a reviewer may switch between from the account block at the bottom of the
// sidebar (Yoann, 2026-09-09 22:40: "ça m'évite de retaper le mot de passe"). The list is the
// one /login prints, plus the two extra brokers the seed creates, so the switch can never reach
// an account this list does not name: POST /api/session/switch refuses any other email before
// it reads the database. The password is not needed for a switch because every account on this
// list shares the one DEMO_PASSWORD that the reviewers already hold; the switch adds no access
// they do not have, it only saves typing it.
export type DemoAccount = {
  email: string;
  // What the menu prints beside the name the database holds: one word a person understands.
  role: "broker" | "customer" | "operations" | "approver";
};

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: "broker@example.com", role: "broker" },
  { email: "broker2@example.com", role: "broker" },
  { email: "broker3@example.com", role: "broker" },
  { email: "customer@example.com", role: "customer" },
  { email: "ops@example.com", role: "operations" },
  { email: "approver@example.com", role: "approver" },
];

// True when the email, lower-cased and trimmed, is one of the six above.
export function isDemoAccountEmail(email: string): boolean {
  const wanted = email.trim().toLowerCase();
  return DEMO_ACCOUNTS.some((account) => account.email === wanted);
}
