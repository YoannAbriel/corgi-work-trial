import { redirect } from "next/navigation";
import { currentUser, type SignedInUser } from "@/lib/auth/current-user";
import { consoleAccessFor } from "./access";

// The console is staff work, and every page of it starts here.
//
// The rule itself is in lib/console/access.ts, as a pure function of the role, so it can be
// proven without a browser, a cookie or an HTTP server. This file is only the part that needs a
// request: read who is signed in, apply the rule, redirect or return.
export async function requireStaff(): Promise<SignedInUser> {
  const user = await currentUser();
  const decision = consoleAccessFor(user?.role ?? null);
  if (decision !== "allow") {
    redirect(decision);
  }
  // consoleAccessFor answers 'allow' only for a signed-in staff user, so `user` is not null here.
  // The cast is the narrowing TypeScript cannot see through a string return; the check above is
  // the guarantee, and redirect() never returns.
  return user as SignedInUser;
}
