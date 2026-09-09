import { notFound } from "next/navigation";
import { Console360 } from "@/components/console-360";
import { isUuid } from "@/lib/http/path-ids";
import type { Query } from "@/lib/ui/views";

// Everything about one customer: their policies, their claims, the money that moved on them and
// the ledger behind it. Staff only, like every console page (lib/console/guard.ts).
export default async function ConsoleCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<Query>;
}) {
  const { customerId } = await params;
  if (!isUuid(customerId)) {
    notFound();
  }
  return <Console360 kind="customer" id={customerId} searchParams={await searchParams} />;
}
