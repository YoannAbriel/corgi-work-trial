import { cookies } from "next/headers";
import { sql } from "@/db/client";
import { readSessionCookie, SESSION_COOKIE_NAME, sessionSecret } from "./session";

// Who is making the current request. Every page and every route handler starts here; none of
// them trusts an id coming from the URL or the form body.

export type UserRole = "broker" | "customer" | "staff_ops" | "staff_approver";

export type SignedInUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  brokerId: string | null; // set for role 'broker': the broker whose policies this user owns
  customerId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns null when there is no cookie, when its signature does not verify, when it has
// expired, or when the user it names no longer exists.
export async function currentUser(): Promise<SignedInUser | null> {
  const cookieStore = await cookies();
  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const userId = readSessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value, sessionSecret(), nowEpochSeconds);
  if (!userId || !UUID.test(userId)) {
    return null;
  }

  const [row] = await sql<
    { id: string; email: string; display_name: string; role: UserRole; broker_id: string | null; customer_id: string | null }[]
  >`
    select id, email, display_name, role, broker_id, customer_id from users where id = ${userId}
  `;
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    brokerId: row.broker_id,
    customerId: row.customer_id,
  };
}
