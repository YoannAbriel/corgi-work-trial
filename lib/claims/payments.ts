import type postgres from "postgres";
import { sql } from "@/db/client";
import { assertIntentIsApproved, createApprovalRequest } from "@/lib/approvals/approvals";
import { bankAccountDestination, type MoneyOutIntent } from "@/lib/approvals/intent";
import { claimPayoutNeedsApproval } from "@/lib/approvals/threshold";
import {
  claimPaymentReturnedEntries,
  claimPaymentSentEntry,
  claimPaymentSettledEntry,
} from "@/lib/ledger/claim-entries";
import { postJournalEntry } from "@/lib/ledger/post";
import { centsFromDatabase } from "@/lib/money/cents";
import {
  newTransferRef,
  returnSimulatedPayout,
  sendSimulatedPayout,
  settleSimulatedPayout,
  simulatedTransferState,
} from "@/lib/rails/simulator";
import {
  BankAccountRejected,
  verifyClaimantBankAccount,
  type BankVerificationResult,
} from "@/lib/rails/bank-verification-simulator";
import {
  ClaimRefused,
  actorUserId,
  assertClaimsOperator,
  assertClaimsOperatorOrJob,
  claimSnapshot,
  entryContext,
  lockClaimForMoneyDecision,
  todayUtc,
  type ClaimActor,
  type ClaimActorOrJob,
  type ClaimSnapshot,
} from "./claims";
import { claimPaymentRefusal } from "./limits";

// Paying a claim: the bank account it would go to, asking to pay, and the three stages the
// LOCAL SIMULATOR rail takes the money through.
//
// The order of operations is the whole safety argument, and it is the same one the Stripe
// refund path uses (ARCHITECTURE.md section 4):
//
//   1. the ceilings are checked and the intent is written, inside ONE transaction that holds
//      the claim lock, so two people asking at the same moment cannot both pass;
//   2. above $1,000, an approval request is written in that SAME transaction, so there is no
//      instant in which a payment exists that nobody has to approve;
//   3. only a separate, later transaction talks to the rail, and it re-reads and re-checks
//      everything first: the approval, the destination account and the three ceilings again.
//
// Nothing here trusts the screen. Every id comes from the URL and is checked against the claim
// it is supposed to belong to.

// ---------------------------------------------------------------------------
// The claimant's bank account
// ---------------------------------------------------------------------------

export type ClaimantBankAccountView = {
  accountHolderName: string;
  routingNumberLast4: string;
  accountNumberLast4: string;
  accountToken: string;
  verificationStatus: "unknown" | "verified" | "failed";
  reason: string;
  recordedAt: Date;
};

// The account that counts is the LATEST one recorded for the claim, whatever its status: the
// most recent evidence about where the money would go is the evidence that governs. Adding a
// new account is how an account is "changed", because the table is append-only, and it is also
// what makes an approval given for the old account refuse to pay the new one.
export async function latestClaimantBankAccount(
  database: postgres.Sql | postgres.TransactionSql,
  claimId: string,
): Promise<ClaimantBankAccountView | null> {
  const [row] = await database<
    {
      account_holder_name: string;
      routing_number_last4: string;
      account_number_last4: string;
      account_token: string;
      verification_status: "unknown" | "verified" | "failed";
      payload: { reason?: string };
      recorded_at: Date;
    }[]
  >`
    select account_holder_name, routing_number_last4, account_number_last4, account_token,
           verification_status, payload, recorded_at
      from claimant_bank_accounts
     where claim_id = ${claimId}
     order by sequence_number desc
     limit 1
  `;
  if (!row) {
    return null;
  }
  return {
    accountHolderName: row.account_holder_name,
    routingNumberLast4: row.routing_number_last4,
    accountNumberLast4: row.account_number_last4,
    accountToken: row.account_token,
    verificationStatus: row.verification_status,
    reason: row.payload?.reason ?? "",
    recordedAt: row.recorded_at,
  };
}

export type AddBankAccountRequest = {
  claimId: string;
  accountHolderName: string;
  routingNumber: string;
  accountNumber: string;
  actor: ClaimActor;
};

// Runs the ownership check and stores its RESULT. The routing and account numbers reach this
// function, are compared, and are never written anywhere: what lands in the database is the
// last four digits of each and the simulator's token.
export async function addClaimantBankAccount(
  request: AddBankAccountRequest,
  database: postgres.Sql = sql,
): Promise<BankVerificationResult> {
  assertClaimsOperator(request.actor);

  const [claim] = await database<{ claimant_name: string }[]>`
    select claimant_name from claims where id = ${request.claimId}
  `;
  if (!claim) {
    throw new ClaimRefused("this claim does not exist");
  }

  let result: BankVerificationResult;
  try {
    result = verifyClaimantBankAccount({
      claimantName: claim.claimant_name,
      accountHolderName: request.accountHolderName,
      routingNumber: request.routingNumber,
      accountNumber: request.accountNumber,
    });
  } catch (error) {
    // A malformed form is a refusal, not a failed ownership check: nothing is recorded.
    if (error instanceof BankAccountRejected) {
      throw new ClaimRefused(error.message);
    }
    throw error;
  }

  await database`
    insert into claimant_bank_accounts (
      claim_id, account_holder_name, routing_number_last4, account_number_last4,
      account_token, verification_status, provider, payload
    ) values (
      ${request.claimId}, ${request.accountHolderName.trim()}, ${result.routingNumberLast4},
      ${result.accountNumberLast4}, ${result.accountToken}, ${result.status}, 'simulator',
      ${database.json({ reason: result.reason, checked_by: request.actor.userId })}
    )
  `;
  return result;
}

// ---------------------------------------------------------------------------
// Asking to pay
// ---------------------------------------------------------------------------

export type RequestClaimPaymentInput = {
  claimId: string;
  amountCents: number;
  actor: ClaimActor;
};

export type RequestedClaimPayment = {
  operationId: string;
  amountCents: number;
  approvalRequestId: string | null; // set when the amount is above the maker-checker threshold
};

export async function requestClaimPayment(
  input: RequestClaimPaymentInput,
  database: postgres.Sql = sql,
): Promise<RequestedClaimPayment> {
  assertClaimsOperator(input.actor);
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new ClaimRefused("a claim payment must be a positive amount of dollars and cents");
  }

  return database.begin(async (transaction) => {
    // Everything below happens under this lock, so a second request on the same claim waits
    // here and then sees what this one wrote (design finding F-21).
    await lockClaimForMoneyDecision(transaction, input.claimId);

    const snapshot = await claimSnapshot(transaction, input.claimId);
    if (!snapshot) {
      throw new ClaimRefused("this claim does not exist");
    }
    if (snapshot.position.isClosed) {
      throw new ClaimRefused("this claim is closed; reopen it before paying anything");
    }

    // Where the money would go, checked before it is asked for and again before it is sent.
    const bankAccount = await latestClaimantBankAccount(transaction, input.claimId);
    if (!bankAccount) {
      throw new ClaimRefused("no bank account has been recorded for this claimant yet");
    }
    if (bankAccount.verificationStatus !== "verified") {
      throw new ClaimRefused(
        `the claimant's bank account is "${bankAccount.verificationStatus}", not verified, so nothing can be paid to it`,
      );
    }

    const refusal = claimPaymentRefusal({
      amountCents: input.amountCents,
      reserveCents: snapshot.position.reserveCents,
      claimPendingCents: snapshot.pendingCents,
      claimPaidCents: snapshot.position.paidCents,
      perOccurrenceLimitCents: snapshot.perOccurrenceLimitCents,
      policyCommittedCents: snapshot.policyCommittedCents,
      aggregateLimitCents: snapshot.aggregateLimitCents,
    });
    if (refusal) {
      throw new ClaimRefused(refusal);
    }

    // Above the threshold, the approval request is written FIRST, in this same transaction, and
    // the money operation carries its id. Nothing can move without it. The threshold is per
    // CLAIM, not per payment (lib/approvals/threshold.ts, review finding F-B7-02): what has
    // already been sent and what is still waiting on this claim count with this payment.
    const needsApproval = claimPayoutNeedsApproval({
      amountCents: input.amountCents,
      claimPaidCents: snapshot.position.paidCents,
      claimPendingCents: snapshot.pendingCents,
    });
    const intent = claimPaymentIntent(snapshot.claimId, input.amountCents, bankAccount.accountToken);
    const approvalRequestId = needsApproval
      ? await createApprovalRequest(transaction, {
          intent,
          destinationDescription:
            `LOCAL SIMULATOR bank account ...${bankAccount.accountNumberLast4} held by ${bankAccount.accountHolderName}`,
          requestedByUserId: input.actor.userId,
          payload: {
            claim_number: snapshot.claimNumber,
            policy_number: snapshot.policyNumber,
            reserve_cents: snapshot.position.reserveCents,
            paid_cents: snapshot.position.paidCents,
          },
        })
      : null;

    const attempt = (await countClaimPayouts(transaction, input.claimId)) + 1;
    const [operation] = await transaction<{ id: string }[]>`
      insert into money_operations
        (kind, provider, amount_cents, policy_id, claim_id, idempotency_key, approval_request_id, created_by)
      values ('claim_payout', 'simulator', ${input.amountCents}, ${snapshot.policyId}, ${snapshot.claimId},
              ${claimPayoutIdempotencyKey(snapshot.claimId, attempt)}, ${approvalRequestId}, ${input.actor.userId})
      returning id
    `;
    await transaction`
      insert into money_operation_events (operation_id, status, payload)
      values (${operation.id}, 'requested',
              ${transaction.json({
                note: needsApproval
                  ? "waiting for a second person to approve it before anything leaves"
                  : "below the approval threshold; it can be sent to the rail straight away",
              })})
    `;
    await transaction`
      insert into claim_events (claim_id, event_type, amount_cents, money_operation_id, payload, created_by)
      values (${snapshot.claimId}, 'payment_requested', ${input.amountCents}, ${operation.id},
              ${transaction.json({ destination_token: bankAccount.accountToken, needs_approval: needsApproval })},
              ${input.actor.userId})
    `;

    return { operationId: operation.id, amountCents: input.amountCents, approvalRequestId };
  });
}

// One key per payment attempt on a claim, derived from the claim and the attempt number, never
// random: a retry of the same attempt reuses it, a new payment gets its own.
export function claimPayoutIdempotencyKey(claimId: string, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`an attempt must be a whole number starting at 1, got ${attempt}`);
  }
  return `claim-payout:${claimId}:${attempt}`;
}

async function countClaimPayouts(
  database: postgres.Sql | postgres.TransactionSql,
  claimId: string,
): Promise<number> {
  const [row] = await database<{ count: string }[]>`
    select count(*)::text as count from money_operations where claim_id = ${claimId} and kind = 'claim_payout'
  `;
  return Number(row.count);
}

// The intent an approver approves and the execution re-checks. Built in one place so the two
// can never be built differently (lib/approvals/intent.ts explains why that matters).
export function claimPaymentIntent(claimId: string, amountCents: number, accountToken: string): MoneyOutIntent {
  return {
    kind: "claim_payment",
    subjectKind: "claim",
    subjectId: claimId,
    amountCents,
    destination: bankAccountDestination(accountToken),
  };
}

// ---------------------------------------------------------------------------
// Sending it on the rail
// ---------------------------------------------------------------------------

export type ClaimPayoutOperation = {
  operationId: string;
  claimId: string;
  amountCents: number;
  approvalRequestId: string | null;
  transferRef: string | null; // set once the rail has accepted it
  hasBeenSent: boolean;
  hasBeenSettled: boolean;
  hasBeenReturned: boolean;
  hasFailed: boolean;
};

export async function claimPayoutOperation(
  database: postgres.Sql | postgres.TransactionSql,
  operationId: string,
): Promise<ClaimPayoutOperation | null> {
  const [row] = await database<
    { id: string; claim_id: string; amount_cents: string; approval_request_id: string | null }[]
  >`
    select id, claim_id, amount_cents, approval_request_id
      from money_operations where id = ${operationId} and kind = 'claim_payout'
  `;
  if (!row || row.claim_id === null) {
    return null;
  }

  const stages = await database<{ event_type: string }[]>`
    select event_type from claim_events where money_operation_id = ${operationId}
  `;
  const lifecycle = await database<{ status: string; provider_ref: string | null }[]>`
    select status, provider_ref from money_operation_events where operation_id = ${operationId} order by sequence_number
  `;
  const reached = (stage: string) => stages.some((row) => row.event_type === stage);

  return {
    operationId: row.id,
    claimId: row.claim_id,
    amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
    approvalRequestId: row.approval_request_id,
    transferRef: lifecycle.find((event) => event.provider_ref !== null)?.provider_ref ?? null,
    hasBeenSent: reached("payment_sent"),
    hasBeenSettled: reached("payment_settled"),
    hasBeenReturned: reached("payment_returned"),
    hasFailed: lifecycle.some((event) => event.status === "failed"),
  };
}

// The payment named in a URL must belong to the claim named in the same URL.
//
// Without this check, POST /api/claims/{claimId}/payments/{operationId} acts on another claim's
// payment: the money functions read the claim from the operation itself, so the financial effect
// lands on the right claim, but on a claim the caller did not name, and only the redirect is
// wrong (review finding F-B7-08). The refund routes already refuse the same mismatch.
export async function assertPaymentBelongsToClaim(
  claimId: string,
  operationId: string,
  database: postgres.Sql = sql,
): Promise<void> {
  const operation = await claimPayoutOperation(database, operationId);
  if (!operation) {
    throw new ClaimRefused("this claim payment does not exist");
  }
  if (operation.claimId !== claimId) {
    throw new ClaimRefused("this payment belongs to another claim");
  }
}

export type SendClaimPaymentResult = {
  outcome: "sent" | "already_sent";
  transferRef: string;
  settlementDate: string;
};

// The only place a claim payment leaves for the rail. Everything is re-read and re-checked here
// and not taken from the request that created the operation: an approval given yesterday must
// not pay a claim whose destination account, reserve or limits have moved since.
export async function sendClaimPayment(
  input: { operationId: string; actor: ClaimActor },
  database: postgres.Sql = sql,
): Promise<SendClaimPaymentResult> {
  assertClaimsOperator(input.actor);

  return database.begin(async (transaction) => {
    const operation = await claimPayoutOperation(transaction, input.operationId);
    if (!operation) {
      throw new ClaimRefused("this claim payment does not exist");
    }
    await lockClaimForMoneyDecision(transaction, operation.claimId);

    // Re-read AFTER the lock: a payment sent by whoever held the lock a moment ago is already
    // done, and this call is a no-op rather than a second transfer.
    const current = await claimPayoutOperation(transaction, input.operationId);
    if (!current) {
      throw new ClaimRefused("this claim payment does not exist");
    }
    if (current.hasBeenSent) {
      const alreadySent = current.transferRef ? await simulatedTransferState(transaction, current.transferRef) : null;
      return {
        outcome: "already_sent" as const,
        transferRef: current.transferRef ?? "",
        settlementDate: alreadySent?.settlementDate ?? "",
      };
    }
    if (current.hasFailed) {
      throw new ClaimRefused("this claim payment was refused or rejected; ask for a new one");
    }

    const snapshot = await claimSnapshot(transaction, current.claimId);
    if (!snapshot) {
      throw new ClaimRefused("this claim does not exist");
    }
    if (snapshot.position.isClosed) {
      throw new ClaimRefused("this claim is closed; nothing can be paid on it");
    }

    // The destination, re-read now. If somebody recorded a different account since the request,
    // the intent below no longer matches the approved one and the payment is refused.
    const bankAccount = await latestClaimantBankAccount(transaction, current.claimId);
    if (!bankAccount || bankAccount.verificationStatus !== "verified") {
      throw new ClaimRefused("the claimant's bank account is not verified, so nothing can be paid to it");
    }

    // Maker-checker, at execution time. Two refusals, and the second one is the important one:
    //   - an operation that carries an approval request must have an approved decision whose
    //     intent still matches what would be paid now;
    //   - an operation ABOVE the threshold that carries no request at all is refused outright.
    //     That cannot happen through requestClaimPayment; it is here so that any future code
    //     path which forgets the queue fails closed instead of paying.
    if (current.approvalRequestId) {
      await assertIntentIsApproved(
        transaction,
        current.approvalRequestId,
        claimPaymentIntent(current.claimId, current.amountCents, bankAccount.accountToken),
      );
    } else if (
      claimPayoutNeedsApproval({
        amountCents: current.amountCents,
        claimPaidCents: snapshot.position.paidCents,
        // This operation is part of the pending total and is the one being sent.
        claimPendingCents: snapshot.pendingCents - current.amountCents,
      })
    ) {
      throw new ClaimRefused(
        "this payment would take the claim above the approval threshold but carries no approval request; it cannot be sent",
      );
    }

    // The three ceilings again, as they stood when the payment was asked for: this operation's
    // own amount is taken out of the pending totals, because it is the one being sent.
    const refusal = claimPaymentRefusal({
      amountCents: current.amountCents,
      reserveCents: snapshot.position.reserveCents,
      claimPendingCents: snapshot.pendingCents - current.amountCents,
      claimPaidCents: snapshot.position.paidCents,
      perOccurrenceLimitCents: snapshot.perOccurrenceLimitCents,
      policyCommittedCents: snapshot.policyCommittedCents - current.amountCents,
      aggregateLimitCents: snapshot.aggregateLimitCents,
    });
    if (refusal) {
      throw new ClaimRefused(refusal);
    }

    const sentOn = todayUtc();
    const transfer = await sendSimulatedPayout(transaction, {
      transferRef: newTransferRef(),
      amountCents: current.amountCents,
      destinationToken: bankAccount.accountToken,
      sentOn,
    });

    const claimEventId = await appendPaymentStage(transaction, {
      claimId: current.claimId,
      eventType: "payment_sent",
      amountCents: current.amountCents,
      operationId: current.operationId,
      payload: { transfer_ref: transfer.transferRef, expected_settlement_date: transfer.settlementDate },
      createdBy: input.actor.userId,
    });
    await transaction`
      insert into money_operation_events (operation_id, status, provider_ref, payload)
      values (${current.operationId}, 'provider_accepted', ${transfer.transferRef},
              ${transaction.json({ expected_settlement_date: transfer.settlementDate })})
    `;

    const entry = claimPaymentSentEntry(
      entryContext(snapshot, claimEventId, sentOn, input.actor.userId),
      current.amountCents,
    );
    await postJournalEntry(transaction, entry.header, entry.lines);

    return { outcome: "sent" as const, transferRef: transfer.transferRef, settlementDate: transfer.settlementDate };
  });
}

// ---------------------------------------------------------------------------
// Settling and returning
// ---------------------------------------------------------------------------

export type SettleClaimPaymentInput = {
  operationId: string;
  settledOn: string; // the day the rail says the money left
  // Who is settling: a staff operator pressing "settle now" on the LOCAL SIMULATOR controls, or
  // SCHEDULED_JOB when the settlement job does it on its settlement date. Stated by every caller
  // rather than inferred, and checked below (review finding F-B7-10).
  settledBy: ClaimActorOrJob;
};

// The rail confirms the money has left. Called by the job for every transfer whose settlement
// date has passed, and by the staff "settle now" button of the LOCAL SIMULATOR controls.
export async function settleClaimPayment(
  input: SettleClaimPaymentInput,
  database: postgres.Sql = sql,
): Promise<{ outcome: "settled" | "already_settled" }> {
  assertClaimsOperatorOrJob(input.settledBy);
  const broughtForwardBy = actorUserId(input.settledBy);

  return database.begin(async (transaction) => {
    const operation = await claimPayoutOperation(transaction, input.operationId);
    if (!operation) {
      throw new ClaimRefused("this claim payment does not exist");
    }
    await lockClaimForMoneyDecision(transaction, operation.claimId);

    const current = await claimPayoutOperation(transaction, input.operationId);
    if (!current || !current.transferRef) {
      throw new ClaimRefused("this claim payment has not been sent on the rail yet");
    }
    if (current.hasBeenSettled) {
      return { outcome: "already_settled" as const };
    }
    if (!current.hasBeenSent) {
      throw new ClaimRefused("this claim payment has not been sent on the rail yet");
    }
    if (current.hasBeenReturned) {
      throw new ClaimRefused("this claim payment was returned by the bank; it cannot settle afterwards");
    }

    const snapshot = await claimSnapshot(transaction, current.claimId);
    if (!snapshot) {
      throw new ClaimRefused("this claim does not exist");
    }

    const bankAccount = await latestClaimantBankAccount(transaction, current.claimId);
    await settleSimulatedPayout(transaction, {
      transferRef: current.transferRef,
      amountCents: current.amountCents,
      destinationToken: bankAccount?.accountToken ?? "",
      settledOn: input.settledOn,
      note: broughtForwardBy
        ? "LOCAL SIMULATOR: settlement brought forward from the claim screen"
        : "LOCAL SIMULATOR: settled by the scheduled job on its settlement date",
    });

    const claimEventId = await appendPaymentStage(transaction, {
      claimId: current.claimId,
      eventType: "payment_settled",
      amountCents: current.amountCents,
      operationId: current.operationId,
      payload: { transfer_ref: current.transferRef, settled_on: input.settledOn },
      createdBy: broughtForwardBy,
    });
    await transaction`
      insert into money_operation_events (operation_id, status, provider_ref, payload)
      values (${current.operationId}, 'succeeded', ${current.transferRef},
              ${transaction.json({ settled_on: input.settledOn })})
    `;

    // The cash entry carries the day the cash moved, exactly as the collection and refund
    // entries do.
    const entry = claimPaymentSettledEntry(
      entryContext(snapshot, claimEventId, input.settledOn, broughtForwardBy),
      current.amountCents,
    );
    await postJournalEntry(transaction, entry.header, entry.lines);

    return { outcome: "settled" as const };
  });
}

export type ReturnClaimPaymentInput = {
  operationId: string;
  returnedOn: string;
  returnReason: string;
  actor: ClaimActor;
};

// The receiving bank sends the money back. The cash comes home, what we owed stops being a
// payment in flight, and the reserve is restored to exactly what it was before the payment: the
// claim is still open and still expects to be paid.
export async function returnClaimPayment(
  input: ReturnClaimPaymentInput,
  database: postgres.Sql = sql,
): Promise<{ outcome: "returned" | "already_returned" }> {
  assertClaimsOperator(input.actor);

  return database.begin(async (transaction) => {
    const operation = await claimPayoutOperation(transaction, input.operationId);
    if (!operation) {
      throw new ClaimRefused("this claim payment does not exist");
    }
    await lockClaimForMoneyDecision(transaction, operation.claimId);

    const current = await claimPayoutOperation(transaction, input.operationId);
    if (!current || !current.transferRef) {
      throw new ClaimRefused("this claim payment has not been sent on the rail yet");
    }
    if (current.hasBeenReturned) {
      return { outcome: "already_returned" as const };
    }
    // A return is the bank giving back money it had taken, so it can only follow a settlement.
    // A transfer that has not settled is cancelled at the rail, which this simulator does not
    // model and which would be a different pair of entries.
    if (!current.hasBeenSettled) {
      throw new ClaimRefused("only a settled payment can be returned by the bank");
    }

    const snapshot = await claimSnapshot(transaction, current.claimId);
    if (!snapshot) {
      throw new ClaimRefused("this claim does not exist");
    }

    const bankAccount = await latestClaimantBankAccount(transaction, current.claimId);
    await returnSimulatedPayout(transaction, {
      transferRef: current.transferRef,
      amountCents: current.amountCents,
      destinationToken: bankAccount?.accountToken ?? "",
      returnedOn: input.returnedOn,
      returnReason: input.returnReason,
    });

    const claimEventId = await appendPaymentStage(transaction, {
      claimId: current.claimId,
      eventType: "payment_returned",
      amountCents: current.amountCents,
      operationId: current.operationId,
      payload: { transfer_ref: current.transferRef, returned_on: input.returnedOn, return_reason: input.returnReason },
      createdBy: input.actor.userId,
    });
    await transaction`
      insert into money_operation_events (operation_id, status, provider_ref, payload)
      values (${current.operationId}, 'returned', ${current.transferRef},
              ${transaction.json({ returned_on: input.returnedOn, return_reason: input.returnReason })})
    `;

    const context = entryContext(snapshot, claimEventId, input.returnedOn, input.actor.userId);
    for (const entry of claimPaymentReturnedEntries(context, current.amountCents)) {
      await postJournalEntry(transaction, entry.header, entry.lines);
    }

    return { outcome: "returned" as const };
  });
}

// One insert, used by all three stages. The unique index on (money_operation_id, event_type)
// means a second concurrent attempt at the same stage fails here and rolls its whole
// transaction back: at most one financial effect per payment and per stage.
async function appendPaymentStage(
  transaction: postgres.TransactionSql,
  input: {
    claimId: string;
    eventType: "payment_sent" | "payment_settled" | "payment_returned";
    amountCents: number;
    operationId: string;
    payload: Record<string, string | number | boolean | null>;
    createdBy: string | null;
  },
): Promise<string> {
  const [claimEvent] = await transaction<{ id: string }[]>`
    insert into claim_events (claim_id, event_type, amount_cents, money_operation_id, payload, created_by)
    values (${input.claimId}, ${input.eventType}, ${input.amountCents}, ${input.operationId},
            ${transaction.json(input.payload)}, ${input.createdBy})
    returning id
  `;
  return claimEvent.id;
}

// The claim payments of one claim, for the screen and for the settle job.
export type ClaimPaymentView = {
  operationId: string;
  amountCents: number;
  requestedAt: Date;
  requestedByName: string | null;
  approvalRequestId: string | null;
  transferRef: string | null;
  railStatus: "waiting for approval" | "ready to send" | "sent" | "settled" | "returned" | "refused";
  settlementDate: string | null;
};

export async function claimPayments(
  database: postgres.Sql | postgres.TransactionSql,
  claimId: string,
): Promise<ClaimPaymentView[]> {
  const rows = await database<
    {
      id: string;
      amount_cents: string;
      created_at: Date;
      approval_request_id: string | null;
      requested_by_name: string | null;
      decision: string | null;
    }[]
  >`
    select operation.id,
           operation.amount_cents,
           operation.created_at,
           operation.approval_request_id,
           requester.display_name as requested_by_name,
           decision.decision
      from money_operations operation
      left join users requester on requester.id::text = operation.created_by
      left join approval_decisions decision on decision.request_id = operation.approval_request_id
     where operation.claim_id = ${claimId} and operation.kind = 'claim_payout'
     order by operation.created_at
  `;

  const views: ClaimPaymentView[] = [];
  for (const row of rows) {
    const operation = await claimPayoutOperation(database, row.id);
    const transfer = operation?.transferRef ? await simulatedTransferState(database, operation.transferRef) : null;
    views.push({
      operationId: row.id,
      amountCents: centsFromDatabase(row.amount_cents, "amount_cents"),
      requestedAt: row.created_at,
      requestedByName: row.requested_by_name,
      approvalRequestId: row.approval_request_id,
      transferRef: operation?.transferRef ?? null,
      railStatus: railStatusOf(operation, row.approval_request_id !== null, row.decision),
      settlementDate: transfer?.settlementDate ?? null,
    });
  }
  return views;
}

function railStatusOf(
  operation: ClaimPayoutOperation | null,
  needsApproval: boolean,
  decision: string | null,
): ClaimPaymentView["railStatus"] {
  if (!operation) {
    return "refused";
  }
  if (operation.hasBeenReturned) {
    return "returned";
  }
  if (operation.hasBeenSettled) {
    return "settled";
  }
  if (operation.hasBeenSent) {
    return "sent";
  }
  if (operation.hasFailed || decision === "rejected") {
    return "refused";
  }
  return needsApproval && decision !== "approved" ? "waiting for approval" : "ready to send";
}
