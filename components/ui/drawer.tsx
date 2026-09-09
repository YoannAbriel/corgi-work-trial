import Link from "next/link";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { DrawerEscape } from "./drawer-escape";

// The drawer: a panel over the content, from the right, at every width (Yoann, cycle 2,
// decisions 5 and 6). The inspector and the amount explanation are the same panel, so a reader
// learns one way of opening a detail and one way of closing it.
//
// Three ways out, all the same navigation: the cross, a click outside (the backdrop is a plain
// link back to `closeHref`, so it works with no script at all) and Escape (the one small client
// component, components/ui/drawer-escape.tsx).
export { DrawerEscape };

export function Drawer({
  title,
  closeHref,
  kind,
  ariaLabel,
  children,
}: {
  title: ReactNode;
  // The same page without the parameter that opened the drawer.
  closeHref: string;
  // A small word above the title: what kind of thing this is.
  kind?: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <>
      {/* Decorative: the cross is the labelled control, this one only catches the click outside. */}
      <Link href={closeHref} prefetch={false} className="drawer-backdrop" aria-hidden="true" tabIndex={-1} scroll={false} />
      <aside className="drawer" aria-label={ariaLabel ?? (typeof title === "string" ? title : "Details")}>
        <div className="drawer-head">
          <div>
            {kind ? <div className="drawer-kind">{kind}</div> : null}
            <h2>{title}</h2>
          </div>
          <Link href={closeHref} prefetch={false} className="drawer-close" aria-label="Close" scroll={false}>
            <X size={16} aria-hidden="true" />
          </Link>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
      <DrawerEscape closeHref={closeHref} />
    </>
  );
}
