import { currentUser } from "@/lib/auth/current-user";
import { BrokerKybRefused, submitBrokerKyb } from "@/lib/broker/kyb-onboarding";

// POST /api/brokers/kyb, called by the form on /broker/kyb.
//
// Three steps, each with its own visible failure path: who is asking, is the form usable, does
// Stripe accept the company. The signed-in user's own broker is the only one that can be
// submitted: the broker id comes from the session, never from the form.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  if (user.role !== "broker" || !user.brokerId) {
    return redirectTo("/broker");
  }

  const form = await request.formData();
  if (form.get("termsAccepted") !== "yes") {
    return backToForm("the Stripe Connected Account Agreement has to be accepted before the company can be submitted");
  }

  // The two facts Stripe records as the account's own acceptance of its agreement. Both are
  // read from this request, never invented: the instant is now, and the address is the one the
  // request came from.
  const termsAcceptedAt = new Date();
  const termsAcceptedFromIp = clientIpAddress(request);

  try {
    const result = await submitBrokerKyb({
      brokerId: user.brokerId,
      legalName: requiredText(form, "legalName"),
      employerIdentificationNumber: requiredText(form, "employerIdentificationNumber").replace(/-/g, ""),
      address: {
        line1: requiredText(form, "addressLine1"),
        city: requiredText(form, "addressCity"),
        state: requiredText(form, "addressState").toUpperCase(),
        postalCode: requiredText(form, "addressPostalCode"),
      },
      businessUrl: requiredText(form, "businessUrl"),
      contactEmail: requiredText(form, "contactEmail").toLowerCase(),
      termsAcceptedAt,
      termsAcceptedFromIp,
      submittedByUserId: user.id,
    });
    return redirectTo(`/broker/kyb?submitted=${encodeURIComponent(result.providerAccountId)}`);
  } catch (error) {
    if (error instanceof BrokerKybRefused || error instanceof InputError) {
      // A refusal the broker can act on: a malformed form, a verification already running, or
      // a request Stripe would not accept. A provider refusal was recorded on the broker's
      // history before this point, so nothing is lost by showing a short message here.
      return backToForm(error.message);
    }
    throw error;
  }
}

class InputError extends Error {}

function requiredText(form: FormData, field: string): string {
  const value = form.get(field);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InputError(`${field} is required`);
  }
  return value.trim();
}

// The address the request came from, as the proxy in front of the application reports it.
// On Vercel that is `x-forwarded-for`, whose first entry is the client. A request that arrives
// with neither header came straight down a local connection, which is what happens in
// development, and 127.0.0.1 is then the truthful answer rather than a placeholder.
function clientIpAddress(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const client = forwardedFor.split(",")[0].trim();
    if (client) return client;
  }
  return request.headers.get("x-real-ip")?.trim() || "127.0.0.1";
}

function backToForm(message: string): Response {
  return redirectTo(`/broker/kyb?error=${encodeURIComponent(message)}`);
}

// 303 turns the POST into a GET, so refreshing the next page does not resubmit the form.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
