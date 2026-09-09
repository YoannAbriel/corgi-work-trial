import { notFound } from "next/navigation";
import { Console360 } from "@/components/console-360";
import { isUuid } from "@/lib/http/path-ids";

// Everything about one broker: their verification history, their policies and claims, the money
// on them, their commission in the ledger and every statement ever published to them.
export default async function ConsoleBrokerPage({ params }: { params: Promise<{ brokerId: string }> }) {
  const { brokerId } = await params;
  if (!isUuid(brokerId)) {
    notFound();
  }
  return <Console360 kind="broker" id={brokerId} />;
}
