// The pure helpers behind the two-level navigation and the inspector.
//
// A rebuilt screen renders ONE view per request, named in the URL (`?view=breaks`), and can open
// ONE record beside its table (`?inspect=pi_3UD...`). Both are plain query parameters on the
// route that already exists, so every link ever written to a screen keeps working. These
// functions validate what the URL says and build the next links; they touch no database and no
// framework, which is why they can be proven in lib/ui/views.test.ts.

export type QueryValue = string | string[] | undefined;
export type Query = Record<string, QueryValue>;

// The view a page renders. Anything the URL says that is not on the page's own list falls back
// to the first view: a mistyped or stale link opens the screen rather than an error.
export function pickView<T extends string>(raw: QueryValue, allowed: readonly T[]): T {
  const wanted = Array.isArray(raw) ? raw[0] : raw;
  const found = allowed.find((view) => view === wanted);
  return found ?? allowed[0];
}

// The first value of a repeated parameter, or undefined. A page reads its filters through this
// so that `?source=stripe&source=claims_rail` never becomes an array where a string is expected.
export function firstValue(raw: QueryValue): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

// One of an allowed set, or null when absent or unknown. For filter chips: `?class=stale`.
export function pickFilter<T extends string>(raw: QueryValue, allowed: readonly T[]): T | null {
  const wanted = firstValue(raw);
  return allowed.find((value) => value === wanted) ?? null;
}

// The href of the same page with some parameters changed. `null` removes a parameter. The
// current query is kept, so a filter chip never loses the view and the view never loses the
// filters. Keys are written in a stable order so two links to the same state are the same string.
export function withParams(pathname: string, current: Query, changes: Record<string, string | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (key in changes) continue;
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) {
      params.append(key, one);
    }
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value !== null) params.set(key, value);
  }
  params.sort();
  const query = params.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}

// The link that opens the inspector on a reference, and the one that closes it.
export function inspectHref(pathname: string, current: Query, reference: string): string {
  return withParams(pathname, current, { inspect: reference });
}
export function closeInspectorHref(pathname: string, current: Query): string {
  return withParams(pathname, current, { inspect: null });
}

// The reference the inspector should open, trimmed and bounded, or null. A reference longer
// than the search accepts (lib/console/read.ts, 200 characters) is treated as absent.
export function inspectedReference(raw: QueryValue): string | null {
  const value = firstValue(raw)?.trim() ?? "";
  if (value === "" || value.length > 200) return null;
  return value;
}

// The notices a screen shows after a POST redirected back to it. Every route already redirects
// with a query parameter (`?error=...`, `?ran=...`, `?payment=...`); a page declares which of
// them it knows and what tone each one carries, and gets the toasts to render.
export type ToastTone = "ok" | "error" | "info";
export type ToastNotice = {
  tone: ToastTone;
  title: string;
  text: string;
  param: string; // the query parameter it came from, removed from the URL once shown
  href?: string;
  hrefLabel?: string;
};
export type ToastRule = { tone: ToastTone; title: string; href?: (value: string) => string; hrefLabel?: string };

export function toastsFromQuery(query: Query, rules: Record<string, ToastRule>): ToastNotice[] {
  const notices: ToastNotice[] = [];
  for (const [param, rule] of Object.entries(rules)) {
    const value = firstValue(query[param]);
    if (value === undefined || value.trim() === "") continue;
    notices.push({
      tone: rule.tone,
      title: rule.title,
      text: value,
      param,
      href: rule.href?.(value),
      hrefLabel: rule.hrefLabel,
    });
  }
  return notices;
}

// A relative age for a screen: "just now", "9 min", "3 h", "2 d", then the date. The full UTC
// instant is always beside it in the markup (components/ui/time.tsx), this is only the glance.
export function relativeAge(instant: Date, now: Date): string {
  const seconds = Math.round((now.getTime() - instant.getTime()) / 1000);
  if (seconds < 0) return utcInstant(instant).slice(0, 10);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d`;
  return utcInstant(instant).slice(0, 10);
}

// "2026-09-09 12:43:39", the one way every screen prints an instant.
export function utcInstant(instant: Date): string {
  return instant.toISOString().replace("T", " ").slice(0, 19);
}
