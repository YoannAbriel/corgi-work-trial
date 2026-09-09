import { currentUser } from "@/lib/auth/current-user";
import { BrokerCreationRefused, createBrokerWithSignIn, mayCreateBrokers, readNewBrokerForm } from "@/lib/broker/create-broker";
import { revealCookieHeader } from "@/lib/broker/reveal-cookie";
import { withActivity } from "@/lib/observability/log";

// POST /api/brokers, called by the "New broker" form on /ops/brokers?view=new (decision 52).
//
// Three steps, each with its own visible failure path: who is asking, is the form usable, does
// the database accept the two rows. Everything it refuses goes back to the form as ?error=, so
// the operator reads the reason on the screen they were on, and the activity log records the
// request as refused (lib/observability/log.ts).
//
// ON SUCCESS the answer carries two things: a redirect to the form with ?created=<brokerId>, and
// a short-lived cookie holding the new account's email and one-time password. THE PASSWORD IS
// NEVER IN THE URL, never in the activity row, never in a log line: only the broker id travels
// in the open, and it is not a secret.
//
// The descriptor names NO RULE deliberately: the closed list in lib/observability/log.ts has no
// name for "who may create a broker", and inventing one would edit a file every other route
// shares. The refusal is still recorded as refused, with its sentence, which is what an operator
// reads.
export const POST = withActivity({ route: "/api/brokers" }, handlePost);

const FORM = "/ops/brokers?view=new";

async function handlePost(request: Request) {
  const user = await currentUser();
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  if (!mayCreateBrokers(user.role)) {
    // A staff approver, a broker, a customer: the same sentence for all of them.
    return redirectTo(`${FORM}&${queryOf({ error: "Only operations staff can create a broker" })}`);
  }

  const form = await request.formData();
  try {
    const newBroker = readNewBrokerForm({
      name: form.get("name"),
      email: form.get("email"),
      commissionRateBps: form.get("commissionRateBps"),
    });
    const created = await createBrokerWithSignIn(newBroker);

    const response = redirectTo(`${FORM}&${queryOf({ created: created.brokerId })}`);
    response.headers.append("set-cookie", revealCookieHeader({ email: created.email, password: created.oneTimePassword }));
    return response;
  } catch (error) {
    if (error instanceof BrokerCreationRefused) {
      // An invalid field or an email that already has an account. Nothing was written in either
      // case: the field checks run before any INSERT, and the duplicate email rolls the whole
      // transaction back (lib/broker/create-broker.ts).
      return redirectTo(`${FORM}&${queryOf({ error: error.message })}`);
    }
    throw error;
  }
}

// One place that escapes what goes into the redirect, so a sentence with a space, an accent or an
// ampersand in it can never break the URL the operator is sent back to.
function queryOf(parameters: Record<string, string>): string {
  return new URLSearchParams(parameters).toString();
}

// 303 turns the POST into a GET on the next page, so a refresh does not create a second broker.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
