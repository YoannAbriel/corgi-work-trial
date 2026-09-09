import { currentUser } from "@/lib/auth/current-user";
import { termEnd } from "@/lib/money/dates";
import { parseUsdAmountToCents } from "@/lib/money/cents";
import { createPolicyDraft, PolicyDraftRefused, type NewPolicyDraft } from "@/lib/policy/issue";
import { withActivity } from "@/lib/observability/log";

// POST /api/policies, called by the form on /broker/policies/new.
// Three steps, each with its own visible failure path: who is asking, is the form usable,
// can the draft be priced.
export const POST = withActivity({ route: "/api/policies" }, handlePost);

async function handlePost(request: Request) {
  const user = await currentUser();
  if (!user) {
    return redirectTo("/login?error=Please+sign+in+again");
  }
  if (user.role !== "broker" || !user.brokerId) {
    return redirectTo("/broker");
  }

  let draft: NewPolicyDraft;
  try {
    draft = readDraftFromForm(await request.formData(), user.brokerId, user.id);
  } catch (error) {
    return backToForm(error);
  }

  try {
    const { policyId } = await createPolicyDraft(draft);
    return redirectTo(`/policies/${policyId}`);
  } catch (error) {
    if (error instanceof PolicyDraftRefused) {
      return backToForm(error);
    }
    // Anything else (a database failure, a bug) is not turned into a friendly message: it
    // must surface as a 500 in the logs rather than look like a rejected form.
    throw error;
  }
}

// Everything the form can get wrong becomes an InputError with a message the broker can read.
class InputError extends Error {}

function readDraftFromForm(form: FormData, brokerId: string, userId: string): NewPolicyDraft {
  const effectiveAt = requiredText(form, "effectiveAt");
  try {
    termEnd(effectiveAt); // refuses a date that does not exist, before anything is written
  } catch {
    throw new InputError(`"${effectiveAt}" is not a calendar date`);
  }

  return {
    brokerId,
    createdByUserId: userId,
    customerName: requiredText(form, "customerName"),
    customerEmail: requiredText(form, "customerEmail").toLowerCase(),
    stateCode: requiredText(form, "stateCode").toUpperCase(),
    effectiveAt,
    annualPremiumCents: requiredAmountCents(form, "annualPremium"),
    perOccurrenceLimitCents: requiredAmountCents(form, "perOccurrenceLimit"),
    aggregateLimitCents: requiredAmountCents(form, "aggregateLimit"),
  };
}

function requiredText(form: FormData, field: string): string {
  const value = form.get(field);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InputError(`${field} is required`);
  }
  return value.trim();
}

function requiredAmountCents(form: FormData, field: string): number {
  try {
    return parseUsdAmountToCents(requiredText(form, field));
  } catch (error) {
    throw new InputError(error instanceof Error ? error.message : `${field} is not a valid amount`);
  }
}

function backToForm(error: unknown): Response {
  const message = error instanceof Error ? error.message : "the draft could not be created";
  return redirectTo(`/broker/policies/new?error=${encodeURIComponent(message)}`);
}

// 303 turns the POST into a GET, so refreshing the next page does not resubmit the form.
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
