import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";

// A panel in the browser's top layer, opened by a button, closed by a click outside or Escape.
// Native `popover` attribute: no script of ours, and nothing on the page can clip it, which is
// what the explanation of an amount inside a table needs. `id` must be unique on the page.
//
// Where the browser supports CSS anchor positioning the panel sits under its button; elsewhere
// it is centred in the viewport (app/styles/system.css).
export function PopoverButton({ id, className, label, children, ...rest }: { id: string; className?: string; label?: string; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "popoverTarget" | "style">) {
  return (
    <button type="button" className={className} popoverTarget={`pop-${id}`} aria-label={label} style={{ anchorName: `--pop-${id}` } as CSSProperties} {...rest}>
      {children}
    </button>
  );
}

export function PopoverPanel({ id, className, children, ...rest }: { id: string; className?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, "id" | "style" | "popover">) {
  return (
    <div id={`pop-${id}`} popover="auto" className={`pop${className ? ` ${className}` : ""}`} style={{ ["--anchor" as string]: `--pop-${id}` }} {...rest}>
      {children}
    </div>
  );
}
