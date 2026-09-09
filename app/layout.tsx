import type { Metadata } from "next";
import "./globals.css";
import "./styles/system.css";

// THERE IS NO loading.tsx IN THIS APPLICATION, AND THAT IS THE LOADING DESIGN (review findings
// F-B13-31 and F-UI-01). It is written here because this is where the next person will think of
// adding one.
//
// Every protected page asks for the session itself and refuses with `redirect()` or `notFound()`
// before it returns any markup, so nothing is flushed until the answer is known: an anonymous
// request answers 307 and a malformed id answers 404, which is what an external check of the
// deployed URL has to see.
//
// A `loading.tsx` puts a Suspense boundary above the page, so its shell is flushed BEFORE the
// page has decided anything, and the status is committed as 200 with the real answer buried in
// the streamed payload. That is exactly the defect F-UI-01 recorded when a root boundary was
// tried. Measured again on a production build of this branch, 2026-09-09, with one boundary per
// route group (/ops, /ops/console, /broker, /customer, /inbox, /policies/[policyId],
// /statements/[runId]): all nine refusal cases answered 200 with the loading sentence in the body
// and "REDIRECT;replace;/login;307;" only inside the payload; with the same seven files removed,
// the same nine answered 307 and 404.
//
// So the loading state of this application is the streamed server render itself: the frame and
// the heading paint first and the tables follow, the page is never blank, and no state that lies
// about an HTTP status is added to name the wait. Naming it on screen would mean moving each
// page's refusals above its own Suspense boundary first.
export const metadata: Metadata = {
  title: "Corgi policy administration (trial)",
  description: "Commercial liability policies with an append-only ledger. Sandbox data only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
