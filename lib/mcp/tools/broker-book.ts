import { MOST_POLICIES_ON_A_360_PAGE, type ConsoleSubject, type ConsoleSubjectKind } from "@/lib/console/read";
import type { usd } from "./tool";

// The header of an inspect_reference file, and the rule that shapes it when the reference
// resolved to a BROKER (review finding F-INSPECT-01).
//
// WHY THIS IS ITS OWN FILE. Everything here is pure: no database, no provider, no clock. Nothing
// else in inspect-reference.ts is, because that file reaches the console readers and, through
// them, the application's connection, which no unit test may open. Keeping these two functions
// apart is what lets broker-book.test.ts prove the rule as a rule, on invented brokers,
// with no server and no database.
//
// THE RULE. A broker file is drawn from that broker's WHOLE BOOK: the money operations are read
// over every policy and claim id of the book, the journal entries widen to the broker's own
// entries, and the activity rows are the broker's. So the header of a broker file names NO
// policy. Naming one (the newest, which is what an id list's first element is) would print a
// policy number, a cached status, a term and four terms in force beside money that belongs to
// the rest of the book as well: the reader would quote the wrong policy in good faith.

export type TermsInForceToday = {
  onDate: string | null;
  annualPremium: ReturnType<typeof usd>;
  premiumTax: ReturnType<typeof usd> & { rateBasisPoints: number };
  policyFee: ReturnType<typeof usd>;
  totalCharge: ReturnType<typeof usd>;
  coverageLimits: { name: string; limit: ReturnType<typeof usd> }[];
};

export type FileHeader = {
  kind: ConsoleSubjectKind;
  policyId: string | null;
  policyNumber: string | null;
  claimId: string | null;
  claimNumber: string | null;
  brokerId: string | null;
  policyStatus: string | null;
  term: { start: string; end: string } | null;
  termsInForceToday: TermsInForceToday | null;
  // True when the lists beside this header are a broker's whole book rather than one object.
  spansAWholeBrokerBook: boolean;
  // How many policies those lists were drawn from. Null when the file is one policy or one claim.
  policiesTheseListsWereDrawnFrom: number | null;
};

// A broker file is drawn from the newest policies of that broker's book, and the console reader
// that lists them caps itself there. Republished in the answer, because a count that silently
// stopped at a cap would read as the whole book.
export const MOST_POLICIES_OF_A_BROKER_BOOK = MOST_POLICIES_ON_A_360_PAGE;

// Every policy field null ON PURPOSE, and the count of what the lists were drawn from beside it.
export function brokerBookHeader(subject: Pick<ConsoleSubject, "id" | "brokerId" | "policyIds">): FileHeader {
  return {
    kind: "broker",
    policyId: null,
    policyNumber: null,
    claimId: null,
    claimNumber: null,
    brokerId: subject.brokerId ?? subject.id,
    policyStatus: null,
    term: null,
    termsInForceToday: null,
    spansAWholeBrokerBook: true,
    policiesTheseListsWereDrawnFrom: subject.policyIds.length,
  };
}

// The same fact in words, for a reader who reads the sentence and not the nulls.
export function brokerBookSentence(policyCount: number): string {
  return (
    "This reference resolved to a BROKER, not to one policy: the money operations, the journal entries and the " +
    `requests below span that broker's whole book, drawn from ${policyCount} ` +
    `${policyCount === 1 ? "policy" : "policies"} (its ${MOST_POLICIES_OF_A_BROKER_BOOK} newest at most). This file ` +
    "therefore names no policy number, no status, no term and no terms in force: open a policy number (CGP-nnnnn) " +
    "or a policy id to read one policy."
  );
}
