"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The console's ten-second refresh (UI-025 of the desktop audit of 2026-09-09).
//
// WHAT IT REPLACES. The page carried <meta http-equiv="refresh" content="10">. A meta refresh is
// a promise made to the BROWSER, not to the page: the browser keeps the countdown after the user
// has navigated somewhere else client-side, and when it fires it sends them back to the console.
// The audit reproduced exactly that: open the console, click Overview, wait, and /ops/console
// comes back on its own.
//
// WHAT IT DOES INSTEAD. A timer that exists only while this component is mounted, that is to say
// only while the console is the page on screen. Leaving the console unmounts it and the cleanup
// clears the timer, so nothing survives to pull the user back.
//
// STILL SERVER-DRIVEN. `router.refresh()` asks the server to render the console again and swaps
// the result in. No figure is computed in the browser and no data is fetched by hand: this
// component holds a timer and nothing else, which is why it renders nothing.
export function ConsoleAutoRefresh({ everySeconds = 10 }: { everySeconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everySeconds * 1000);
    return () => clearInterval(timer);
  }, [router, everySeconds]);

  return null;
}
