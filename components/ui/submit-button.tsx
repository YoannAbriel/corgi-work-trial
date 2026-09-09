"use client";

import { useEffect, useRef, useState } from "react";

// A submit button that shows it is working (F-YA-09). The forms of this application are plain
// HTML posts to routes that redirect, so there is no client action to await: the button listens
// to its own form's submit event, disables itself and shows a spinner until the next page
// arrives. Nothing else changes: the form, its action and its fields are the ones the page wrote.
export function SubmitButton({ children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useRef<HTMLButtonElement>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onSubmit = () => setWorking(true);
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);

  return (
    <button ref={ref} type="submit" className={`${className ?? ""}${working ? " is-working" : ""}`.trim() || undefined} aria-busy={working || undefined} {...rest}>
      {children}
    </button>
  );
}
