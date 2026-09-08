import { createHash } from "node:crypto";

// ===========================================================================================
// LOCAL SIMULATOR: bank account ownership check
// ===========================================================================================
//
// THIS IS NOT A LIVE INTEGRATION. No request leaves this process. It stands in for a real
// ownership check (Plaid Auth plus Identity would be the live version, recorded as a day-two
// stretch in DECISIONS.md, 2026-09-08 07:39) and it is labelled LOCAL SIMULATOR everywhere it
// appears: in the README integration inventory, on the claim screen, and in this file.
// AF-02 forbids presenting it as anything else.
//
// What it decides, and it is the whole rule:
//
//   VERIFIED  when the account holder name matches the claimant's name on the claim, AND the
//             routing number is one of the test routing numbers documented below;
//   FAILED    in every other case.
//
// A payment cannot be requested to an account that is not verified (lib/claims/payments.ts).
//
// What it stores, and this matters more than the rule: nothing that identifies a bank account.
// The routing and account numbers are read here, used for the comparison, and dropped. What is
// written to claimant_bank_accounts is the last four digits of each and an opaque token
// (AGENTS.md, KYC section: "Store only required data. Do not put ... bank details ... in logs,
// fixtures, Git or screenshots"). This module never logs its inputs.

// The routing numbers this simulator can reach. They are test values OF THIS BUILD, published
// here so a reviewer can reproduce both outcomes; they are not a bank directory and they are
// not real institutions.
//
//   110000000  the simulator's "reachable bank": ownership is then decided by the name
//   110000005  a second reachable bank, so the demo can show two accounts
//
// Any other routing number is an unreachable bank and the check fails. Real ABA check-digit
// validation is deliberately not implemented: it would add arithmetic to defend for no gain in
// a simulator whose whole input set is written above.
export const SIMULATED_REACHABLE_ROUTING_NUMBERS = ["110000000", "110000005"] as const;

export type BankVerificationResult = {
  status: "verified" | "failed";
  reason: string; // shown on the claim screen and stored on the claimant_bank_accounts row
  routingNumberLast4: string;
  accountNumberLast4: string;
  accountToken: string;
};

export type BankVerificationRequest = {
  claimantName: string; // the name on the claim: the account has to belong to that person
  accountHolderName: string;
  routingNumber: string;
  accountNumber: string;
};

export function verifyClaimantBankAccount(request: BankVerificationRequest): BankVerificationResult {
  const routingNumber = request.routingNumber.replace(/[\s-]/g, "");
  const accountNumber = request.accountNumber.replace(/[\s-]/g, "");

  // Shape first, so a typo is reported as a typo rather than as a failed ownership check.
  if (!/^[0-9]{9}$/.test(routingNumber)) {
    throw new BankAccountRejected("a US routing number is exactly nine digits");
  }
  if (!/^[0-9]{4,17}$/.test(accountNumber)) {
    throw new BankAccountRejected("a US account number is between four and seventeen digits");
  }
  if (request.accountHolderName.trim().length === 0) {
    throw new BankAccountRejected("the account holder name is required: it is what the check compares");
  }

  const identity = {
    routingNumberLast4: routingNumber.slice(-4),
    accountNumberLast4: accountNumber.slice(-4),
    accountToken: simulatedAccountToken(routingNumber, accountNumber),
  };

  const bankIsReachable = (SIMULATED_REACHABLE_ROUTING_NUMBERS as readonly string[]).includes(routingNumber);
  if (!bankIsReachable) {
    return {
      ...identity,
      status: "failed",
      reason: `LOCAL SIMULATOR: routing number ...${identity.routingNumberLast4} is not a bank this simulator can reach`,
    };
  }

  if (!namesMatch(request.accountHolderName, request.claimantName)) {
    return {
      ...identity,
      status: "failed",
      reason: `LOCAL SIMULATOR: the account is held by "${request.accountHolderName.trim()}", not by the claimant "${request.claimantName.trim()}"`,
    };
  }

  return {
    ...identity,
    status: "verified",
    reason: `LOCAL SIMULATOR: the account at routing ...${identity.routingNumberLast4} is held by the claimant`,
  };
}

// A refusal a person can act on: the form was filled in wrongly, no check was performed and
// nothing was written. Kept apart from a FAILED verification, which IS a result and is stored.
export class BankAccountRejected extends Error {}

// Names are compared case-insensitively, with runs of whitespace and punctuation reduced, so
// "Bay Area Fabrication, LLC" and "bay area fabrication llc" are the same holder. Anything
// looser (initials, nicknames, fuzzy distance) would be inventing a matching policy; anything
// stricter would fail on a comma.
function namesMatch(accountHolderName: string, claimantName: string): boolean {
  return normaliseName(accountHolderName) === normaliseName(claimantName);
}

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The stand-in for the token a real bank-verification provider would give back. It is a digest
// of the account, so the SAME bank account always produces the SAME token: that is what lets an
// approval be bound to a destination and refused when the destination changes
// (lib/approvals/intent.ts). It is one-way, so the token in the database and on screen does not
// give the account back.
//
// The salt below is a constant of this build, not a secret: this is a simulator holding
// synthetic accounts only (AF-04), and treating the digest as a vault token would be claiming
// a property it does not have.
const SIMULATED_TOKEN_SALT = "corgi-trial-local-simulator-bank-account-v1";

function simulatedAccountToken(routingNumber: string, accountNumber: string): string {
  const digest = createHash("sha256")
    .update(`${SIMULATED_TOKEN_SALT}:${routingNumber}:${accountNumber}`, "utf8")
    .digest("hex");
  return `sim_ba_${digest.slice(0, 32)}`;
}
