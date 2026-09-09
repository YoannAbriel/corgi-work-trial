import Link from "next/link";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// A row of figures. Every value arrives formatted by the page (formatCentsAsUsd for money, a
// plain count otherwise); nothing here computes.
export function Stats({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`stats${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function Stat({
  label,
  value,
  unit,
  note,
  tone = "neutral",
  href,
  icon: Icon,
  hint,
  spark,
  className: extraClassName,
}: {
  label: ReactNode;
  value: ReactNode;
  // A small word after the figure: "records", "open".
  unit?: ReactNode;
  note?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "accent";
  // A tile that opens the view holding the detail.
  href?: string;
  icon?: LucideIcon;
  // The provider, the window or the rule behind the figure: one sentence on a small info icon,
  // never a third line in the tile (cycle 2, decision 2).
  hint?: string;
  // A sparkline (components/ui/charts.tsx) under the figure.
  spark?: ReactNode;
  className?: string;
}) {
  const className = `stat tone-${tone}${extraClassName ? ` ${extraClassName}` : ""}`;
  const body = (
    <>
      <span className="stat-label">
        {Icon ? <Icon size={13} strokeWidth={1.8} aria-hidden="true" /> : null}
        {label}
        {hint ? (
          <span className="stat-hint" title={hint}>
            <Info size={13} strokeWidth={1.8} aria-hidden="true" />
            <span className="visually-hidden">{hint}</span>
          </span>
        ) : null}
      </span>
      <span className="stat-value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </span>
      {spark ? <span className="stat-spark">{spark}</span> : null}
      {note ? <span className="stat-note">{note}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} prefetch={false} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
