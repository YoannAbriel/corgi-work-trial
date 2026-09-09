import { notFound } from "next/navigation";
import { Console360 } from "@/components/console-360";
import { isUuid } from "@/lib/http/path-ids";

// Everything about one claim, read from every table that mentions it.
export default async function ConsoleClaimPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  if (!isUuid(claimId)) {
    notFound();
  }
  return <Console360 kind="claim" id={claimId} />;
}
