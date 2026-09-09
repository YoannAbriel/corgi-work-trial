import { currentUser } from "@/lib/auth/current-user";
import { expiredRevealCookieHeader } from "@/lib/broker/reveal-cookie";
import { withActivity } from "@/lib/observability/log";

// POST /ops/brokers/reveal/consume: the sign-in details have been read, remove them.
//
// It lives UNDER /ops/brokers on purpose. The reveal cookie is scoped to that path
// (lib/broker/reveal-cookie.ts), so this is one of the two addresses a browser sends it to, and
// the deletion it answers with carries the same name and the same path, which is what a browser
// needs in order to match the cookie it already holds.
//
// It is called by the small client component beside the password (components/ui/reveal-done.tsx)
// as soon as that block appears. The cookie would expire on its own after two minutes anyway;
// this makes "shown once" true immediately rather than eventually.
//
// The password is not read here, and there is nothing to read: the answer removes the cookie
// without ever looking at what was in it.
//
// No rule is named in the descriptor, the same known deviation as POST /api/brokers and recorded
// for the same reason (review finding F-NEWBROKER-02): the 401 and the 403 below are stored in
// activity_log with rule = none, so the console's Rule column reads "none" for them until the
// coordinator adds "broker creation" to the closed union of lib/observability/log.ts after the
// merge. The outcome is still recorded as refused.
export const POST = withActivity({ route: "/ops/brokers/reveal/consume" }, handlePost);

async function handlePost() {
  const user = await currentUser();
  if (!user) {
    return new Response(null, { status: 401 });
  }
  // Whoever can open /ops/brokers can clear the reveal on it. That is staff, both kinds: an
  // approver reading the screen over an operator's shoulder can close the block too.
  if (user.role !== "staff_ops" && user.role !== "staff_approver") {
    return new Response(null, { status: 403 });
  }

  // 204: nothing to say, and nothing to render. The only thing that matters is the header.
  return new Response(null, { status: 204, headers: { "set-cookie": expiredRevealCookieHeader() } });
}
