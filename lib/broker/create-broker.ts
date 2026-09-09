import { sql } from "@/db/client";
import { generateOneTimePassword, hashPassword } from "@/lib/auth/password";
import { isCookieSafeValue } from "@/lib/broker/reveal-cookie";

// Creating a broker from the operations screen (decision 52, Yoann, 2026-09-09 at 22:45 local).
//
// WHAT THE USER DOES. A staff operations user opens /ops/brokers?view=new, types a broker name,
// a contact email and a commission rate in basis points, and presses "Create the broker". Two
// rows are written in ONE transaction: the broker, and the sign-in account of that broker. The
// operator is then shown, once, the one-time password of the new account.
//
// WHAT IS NEVER WRITTEN. No money row of any kind: no journal entry, no policy, no money
// operation. A broker with no verification event is not eligible to bind anything
// (lib/broker/kyb.ts: no event means unknown, and unknown refuses), so creating one grants
// nothing beyond the ability to sign in and submit a business verification.
//
// WHY ONE TRANSACTION. A broker with no account is a broker nobody can sign in as, and an
// account with no broker is a user whose every page redirects. The duplicate email is the case
// that makes this real: users.email is unique, so the second INSERT is refused by the database,
// and the broker row of the first INSERT must disappear with it.

// A refusal the operator can act on, shown as ?error= on the form they came from. Never a 500.
export class BrokerCreationRefused extends Error {}

export const NAME_MAX_LENGTH = 120;
export const EMAIL_MAX_LENGTH = 200;

// What the form sends, before anything has been checked. Everything is text at this point,
// because an HTML form has no other kind of field.
export type NewBrokerForm = {
  name: unknown;
  email: unknown;
  commissionRateBps: unknown;
};

// The same three fields, checked, with the commission as a number of basis points.
export type NewBroker = {
  name: string;
  email: string;
  commissionRateBps: number;
};

// Only staff operations create brokers. A staff approver does not: the role that decides a
// money-out must not also be the role that creates the counterparty it will be paid to
// (the same separation as POST /api/mcp-keys, review finding F-INT-01).
export function mayCreateBrokers(role: string | undefined): boolean {
  return role === "staff_ops";
}

// Checks the three fields and names the one that is wrong. Nothing is written before this
// returns: an invalid form leaves the database exactly as it was.
export function readNewBrokerForm(form: NewBrokerForm): NewBroker {
  const name = String(form.name ?? "").trim();
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
    throw new BrokerCreationRefused(`The broker name must be 1 to ${NAME_MAX_LENGTH} characters`);
  }

  const email = String(form.email ?? "").trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH || !looksLikeAnEmailAddress(email)) {
    throw new BrokerCreationRefused(`The contact email must be an email address of at most ${EMAIL_MAX_LENGTH} characters`);
  }
  // The address is handed straight back to the browser inside the reveal cookie, so it may only
  // hold characters a cookie value may hold (review finding F-NEWBROKER-01). Refused HERE, before
  // any INSERT, because the harm of letting one through is an account that exists and whose
  // one-time password was destroyed on the way to the screen that was supposed to show it.
  if (!isCookieSafeValue(email)) {
    throw new BrokerCreationRefused("The contact email must not contain a semicolon, a comma, a quote or a backslash");
  }

  // Number() on "" is 0 and on "12abc" is NaN, so both are rejected by the two checks below
  // rather than being read as a rate. `10000` basis points is 100%, the ceiling the database
  // CHECK of migration 0002 also enforces.
  const commissionRateText = String(form.commissionRateBps ?? "").trim();
  const commissionRateBps = Number(commissionRateText);
  if (commissionRateText.length === 0 || !Number.isInteger(commissionRateBps) || commissionRateBps < 0 || commissionRateBps > 10000) {
    throw new BrokerCreationRefused("The commission rate must be a whole number of basis points from 0 to 10000");
  }

  return { name, email, commissionRateBps };
}

// Deliberately small: one @, something before it, and a dot inside what follows. The browser
// already refuses an obviously wrong address (type="email") and the account is created by a
// colleague sitting in the office, not by a stranger on the internet. A longer expression would
// look like a guarantee it cannot give.
function looksLikeAnEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export type CreatedBroker = {
  brokerId: string;
  email: string;
  // The password in clear text, returned ONCE to the caller so the route can show it to the
  // operator. It is not stored anywhere: only its hash goes into the database.
  oneTimePassword: string;
};

// Writes the broker and its sign-in account, in one transaction, and returns the password the
// operator has to be shown. Throws BrokerCreationRefused when the email is already an account.
export async function createBrokerWithSignIn(newBroker: NewBroker): Promise<CreatedBroker> {
  const oneTimePassword = generateOneTimePassword();
  // Hashed BEFORE the transaction opens: scrypt takes about a tenth of a second on purpose, and
  // that is time a database transaction would otherwise spend holding its rows.
  const passwordHash = await hashPassword(oneTimePassword);

  try {
    const brokerId = await sql.begin(async (transaction) => {
      const [broker] = await transaction<{ id: string }[]>`
        insert into brokers (name, commission_rate_bps)
        values (${newBroker.name}, ${newBroker.commissionRateBps})
        returning id
      `;
      await transaction`
        insert into users (email, display_name, role, broker_id, password_hash)
        values (
          ${newBroker.email},
          -- The display name is the broker name with " (broker)" after it, so that a staff
          -- screen listing people can tell the broker's account from a customer of the same
          -- company without having to join anything.
          ${`${newBroker.name} (broker)`},
          'broker',
          ${broker.id},
          ${passwordHash}
        )
      `;
      return broker.id;
    });
    return { brokerId: brokerId as string, email: newBroker.email, oneTimePassword };
  } catch (error) {
    // The unique index on users.email. The broker INSERT of the same transaction is rolled back
    // with it, so a refused creation leaves no half-written broker behind.
    if (isDuplicateEmail(error)) {
      throw new BrokerCreationRefused("That email already has an account");
    }
    throw error;
  }
}

// 23505 is the PostgreSQL code for a unique violation. The constraint name is checked too, so a
// unique violation on some other table can never be reported to the operator as a taken email.
function isDuplicateEmail(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const asPostgresError = error as { code?: string; constraint_name?: string };
  return asPostgresError.code === "23505" && asPostgresError.constraint_name === "users_email_key";
}
