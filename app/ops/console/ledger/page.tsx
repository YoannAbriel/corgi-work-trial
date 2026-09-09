import { redirect } from "next/navigation";
import type { Query } from "@/lib/ui/views";

// The ledger left the console on 2026-09-09: it is a sidebar entry of its own at /ops/ledger,
// with its own four views. This file is what keeps the links that were written before that move
// working, and nothing else: a bookmark, a screenshot in a review record, a URL pasted in a
// ticket. It answers before any read of the session, so an old link never lands on the sign-in
// screen when the real destination would have been readable.
//
// The query string is rebuilt rather than forwarded whole, because that is the part that carries
// the view the reader asked for (`?view=flows`), the date, the account and the filters.
export default async function MovedLedgerPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === "string") parameters.append(name, value);
    // Next hands a repeated parameter as an array, and every one of its values is kept.
    else if (Array.isArray(value)) for (const one of value) parameters.append(name, one);
  }
  const search = parameters.toString();
  redirect(search === "" ? "/ops/ledger" : `/ops/ledger?${search}`);
}
