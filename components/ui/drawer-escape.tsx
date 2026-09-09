"use client";

import { useEffect } from "react";

// Escape closes the drawer. This is the only script the drawer needs: closing is a navigation
// to the same page without the parameter that opened it, exactly what the cross and the
// backdrop link do, so the three ways out cannot disagree.
export function DrawerEscape({ closeHref }: { closeHref: string }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.location.assign(closeHref);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeHref]);
  return null;
}
