import { notFound } from "next/navigation";
import { Console360 } from "@/components/console-360";
import { isUuid } from "@/lib/http/path-ids";
import type { Query } from "@/lib/ui/views";

// Everything about one policy, read from every table that mentions it.
// A path id that is not a uuid is answered as an unknown policy, never with a 500 from the query
// that would cast it (the rule of lib/http/path-ids.ts, review finding F-B7-07).
export default async function ConsolePolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<Query>;
}) {
  const { policyId } = await params;
  if (!isUuid(policyId)) {
    notFound();
  }
  // The panel to show and the reference to inspect are query parameters of this route
  // (lib/ui/views.ts); the component reads them and renders one panel.
  return <Console360 kind="policy" id={policyId} searchParams={await searchParams} />;
}
