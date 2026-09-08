import type { UserRole } from "@/lib/auth/current-user";

// What a key may see, and what it may ask for. Pure functions: a user, a thing, and a sentence
// saying no, or null saying yes.
//
// THE RULE: an API key sees exactly what its user sees on the screens, never more. There is no
// second permission model to keep in step. A broker key sees that broker's policies and that
// broker's statements; a customer key sees that customer's policies; a staff key sees
// everything and is the only one that can look at reconciliation breaks or ask for a claim
// payment. The tools call these functions before they read anything, and the check script
// proves each refusal over HTTP.
//
// They are written as "refusal or null" rather than as booleans so the sentence the caller gets
// is defined here, next to the rule, instead of being invented at each call site.

export type ScopedUser = {
  id: string;
  displayName: string;
  role: UserRole;
  brokerId: string | null;
  customerId: string | null;
};

export function isStaff(user: ScopedUser): boolean {
  return user.role === "staff_ops" || user.role === "staff_approver";
}

// A policy is visible to the broker who produced it, to the customer it covers, and to staff.
// ONE SENTENCE FOR BOTH "it does not exist" AND "it is not yours", deliberately: a key must not
// be able to discover which policy numbers exist by comparing two different refusals.
export const POLICY_NOT_VISIBLE = "no policy with that number is visible to this key";

export function policyVisibilityRefusal(
  user: ScopedUser,
  policy: { brokerId: string; customerId: string } | null,
): string | null {
  if (!policy) {
    return POLICY_NOT_VISIBLE;
  }
  if (isStaff(user)) {
    return null;
  }
  if (user.role === "broker" && user.brokerId === policy.brokerId) {
    return null;
  }
  if (user.role === "customer" && user.customerId === policy.customerId) {
    return null;
  }
  return POLICY_NOT_VISIBLE;
}

// Which broker's statement this key may read. "me" is the broker behind the key, which is the
// only value a broker key can use; a staff key may name any broker id. A customer has no
// commission account, so there is nothing for a customer key to read here.
export type StatementScope = { brokerId: string } | { refusal: string };

export function statementBrokerFor(user: ScopedUser, requestedBrokerId: string): StatementScope {
  const asked = requestedBrokerId.trim();
  if (user.role === "broker") {
    if (!user.brokerId) {
      return { refusal: "this broker user is not attached to a broker" };
    }
    if (asked === "me" || asked === user.brokerId) {
      return { brokerId: user.brokerId };
    }
    return { refusal: "a broker key can only read its own statements; pass \"me\"" };
  }
  if (isStaff(user)) {
    if (asked === "me") {
      return { refusal: "a staff key has no broker of its own; pass the broker id" };
    }
    return { brokerId: asked };
  }
  return { refusal: `only a broker or staff can read a broker statement; this key belongs to a "${user.role}"` };
}

// The two staff-only surfaces: the reconciliation breaks, and running the reconciliation job.
// Both staff roles qualify, exactly as /api/jobs/reconcile does for the "Run now" button.
export function staffOnlyRefusal(user: ScopedUser, what: string): string | null {
  if (isStaff(user)) {
    return null;
  }
  return `only staff can ${what}; this key belongs to a "${user.role}"`;
}

// Asking for a claim payment is a MAKER action, so it needs the maker role. staff_approver is
// refused here for the same reason it is refused in lib/claims/claims.ts: the checker must not
// also be the maker, or maker-checker means nothing. A broker or a customer key is refused
// outright.
export function claimPaymentRequesterRefusal(user: ScopedUser): string | null {
  if (user.role === "staff_ops") {
    return null;
  }
  if (user.role === "staff_approver") {
    return "an approver cannot ask for a payment they would then have to approve; use a staff_ops key";
  }
  return `only staff operations can ask for a claim payment; this key belongs to a "${user.role}"`;
}
