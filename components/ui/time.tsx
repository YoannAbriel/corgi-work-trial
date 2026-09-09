import { relativeAge, utcInstant } from "@/lib/ui/views";

// An instant on a screen: at a glance as an age ("9 min"), in full as UTC on hover and in the
// markup. `now` is read once by the page, so every age on it is measured from the same clock.
export function When({ instant, now, mode = "age" }: { instant: Date | null | undefined; now: Date; mode?: "age" | "utc" | "both" }) {
  if (!instant) return <span className="dt-muted">none</span>;
  const full = `${utcInstant(instant)} UTC`;
  if (mode === "utc") {
    return <time dateTime={instant.toISOString()}>{utcInstant(instant)}</time>;
  }
  const age = relativeAge(instant, now);
  if (mode === "both") {
    return (
      <time dateTime={instant.toISOString()} title={full}>
        {age}
        <span className="dt-sub">{utcInstant(instant)}</span>
      </time>
    );
  }
  return (
    <time dateTime={instant.toISOString()} title={full}>
      {age}
    </time>
  );
}
