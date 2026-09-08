import { timingSafeEqual } from "node:crypto";

// Who is allowed to run a job endpoint.
//
// There is no background worker in this build (DECISIONS.md, 2026-09-08 07:39: one Next.js
// application, no long-running process), so the recurring work lives behind HTTP endpoints
// called by a Vercel cron job and by a staff "Run now" button. Those endpoints move money, so
// they are authenticated with CRON_SECRET carried as a bearer token, exactly as Vercel's cron
// jobs send it.
//
// The secret is compared byte by byte in constant time, like the session signature, so the
// answer time does not tell an attacker how much of a guess was right. It is never logged and
// never returned in an error.

export class JobNotAuthorised extends Error {}

export function assertJobIsAuthorised(request: Request): void {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret || configuredSecret.length < 16) {
    // Fail closed: a job endpoint with no secret configured is an open door, not a convenience.
    throw new JobNotAuthorised("this job endpoint is not configured");
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(configuredSecret);
  if (presentedBytes.length !== expectedBytes.length || !timingSafeEqual(presentedBytes, expectedBytes)) {
    throw new JobNotAuthorised("this job endpoint needs the cron secret as a bearer token");
  }
}

// Every job answers the same shape, so the staff screen and the cron log read alike.
export function jobResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
