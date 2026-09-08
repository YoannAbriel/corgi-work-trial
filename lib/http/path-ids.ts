// Every id this application puts in a URL is a uuid the database generated. A path carrying
// anything else is a malformed request, not a missing row, and it must be answered as one.
//
// Before this guard, /ops/claims/not-a-uuid and POST /api/claims/not-a-uuid/... answered 500,
// because the text reached a query that casts it to uuid and Postgres raised (review finding
// F-B7-07). An unknown but well-formed uuid was already handled correctly: 404 on a page, a
// refusal sentence on a route. This makes the malformed case answer in the same register.

// The canonical form Postgres prints and gen_random_uuid() produces: 8-4-4-4-12 hexadecimal
// digits. Postgres also accepts braces and a form with no dashes, deliberately not allowed here:
// no link, form or screen of this application ever produces one.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

// The answer an API route gives when one of its path ids is not a uuid, or null when they are
// all fine. Called on the first line of every route that reads an id from its path.
//
// 400 rather than 404: the request itself is malformed, and answering 404 would suggest that a
// well-formed id was looked up and not found. The offending value is named but never echoed
// back, so nothing a caller put in the URL is reflected into the response body.
export function badPathIdResponse(pathIds: Record<string, string>): Response | null {
  for (const [name, value] of Object.entries(pathIds)) {
    if (!isUuid(value)) {
      return new Response(`the ${name} in this URL is not a valid identifier\n`, {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  }
  return null;
}
