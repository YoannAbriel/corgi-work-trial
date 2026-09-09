"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Yoann's decision of 2026-09-09: changing page puts the reader back at the top of it. A client
// navigation keeps the scroll position of the screen it left unless something asks otherwise, so
// this is that guarantee written once, in the frame, instead of a prop repeated on every link.
//
// It fires on a change of route AND on a change of `view`, because a view of the same route is a
// different screen to the reader. It deliberately fires on nothing else: a filter chip and the
// inspector drawer (`?inspect=`) leave the reader exactly where they were reading.
//
// A named anchor wins. A link that carries one (/inbox#approvals) is asking for a position of its
// own, and moving to the top instead would take the reader away from what they clicked.
//
// It renders nothing. It reads the URL, so it is wrapped in a <Suspense> boundary where it is
// mounted: useSearchParams in a client component makes its whole tree dynamic otherwise, and the
// statically prerendered pages of this application would fail the build.
export function ScrollToTop() {
  const pathname = usePathname();
  const view = useSearchParams().get("view");

  useEffect(() => {
    if (window.location.hash !== "") return;
    // No smooth behaviour: the new screen must already be at the top when the reader looks at it.
    window.scrollTo(0, 0);
  }, [pathname, view]);

  return null;
}
