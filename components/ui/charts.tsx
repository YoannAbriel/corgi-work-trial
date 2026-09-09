import type { ReactNode } from "react";

// Charts drawn on the server as SVG. No library, no script: the browser receives the finished
// picture and the stylesheet animates it once (app/styles/system.css). Every value arrives as a
// number the page already computed or read; the only arithmetic here is geometry.
//
// Each chart carries the same data as text for a screen reader (`<title>` and a hidden table),
// so a figure is never only a picture.

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "#ffb27a", "#5d5e63"];

// `key` is only needed when two points share a label (one bar per run, say).
export type Point = { label: string; value: number; color?: string; key?: string };

// The frame of a chart: a small heading, an optional big figure at the right, the picture.
export function Chart({ title, figure, children, legend, className }: { title: ReactNode; figure?: ReactNode; children: ReactNode; legend?: ReactNode; className?: string }) {
  return (
    <section className={`chart${className ? ` ${className}` : ""}`}>
      <h3>
        <span>{title}</span>
        {figure ? <b>{figure}</b> : null}
      </h3>
      {children}
      {legend ? <div className="chart-legend">{legend}</div> : null}
    </section>
  );
}

export function ChartRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`chart-row${className ? ` ${className}` : ""}`}>{children}</div>;
}

function HiddenTable({ caption, points, format }: { caption: string; points: Point[]; format: (value: number) => string }) {
  // The div carries the hiding: a table's width is a minimum, so a 1 px table still lays out
  // at its content width and scrolls the page sideways on a narrow screen.
  return (
    <div className="visually-hidden">
      <table>
        <caption>{caption}</caption>
        <tbody>
          {points.map((point, index) => (
            <tr key={point.key ?? `${point.label}-${index}`}>
              <th scope="row">{point.label}</th>
              <td>{format(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const plain = (value: number) => String(value);

// Vertical bars: one per label, for counts over time or per category.
export function Bars({
  points,
  height = 120,
  format = plain,
  caption,
  showValues = true,
}: {
  points: Point[];
  height?: number;
  format?: (value: number) => string;
  caption: string;
  showValues?: boolean;
}) {
  if (points.length === 0) return <p className="chart-empty">Nothing to draw.</p>;
  const width = Math.max(240, points.length * 36);
  const top = showValues ? 16 : 6;
  const bottom = 20;
  const plotHeight = height - top - bottom;
  const max = Math.max(1, ...points.map((point) => point.value));
  const slot = width / points.length;
  const barWidth = Math.min(28, slot * 0.62);
  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={caption} preserveAspectRatio="xMinYMid meet" style={{ maxHeight: height }}>
        <title>{caption}</title>
        <line x1={0} x2={width} y1={top + plotHeight + 0.5} y2={top + plotHeight + 0.5} stroke="var(--line)" />
        {points.map((point, index) => {
          const barHeight = Math.round((point.value / max) * plotHeight);
          const x = index * slot + (slot - barWidth) / 2;
          const y = top + plotHeight - barHeight;
          return (
            <g key={point.key ?? `${point.label}-${index}`}>
              <rect className="bar" x={x} y={y} width={barWidth} height={barHeight} rx={4} fill={point.color ?? PALETTE[0]} style={{ animationDelay: `${index * 25}ms` }} />
              {showValues && point.value > 0 ? (
                <text className="value-label" x={x + barWidth / 2} y={y - 4} textAnchor="middle">
                  {format(point.value)}
                </text>
              ) : null}
              <text className="axis-label" x={x + barWidth / 2} y={height - 5} textAnchor="middle">
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
      <HiddenTable caption={caption} points={points} format={format} />
    </>
  );
}

// Stacked vertical bars: several series per label, for flows per day.
export function StackedBars({
  labels,
  series,
  height = 140,
  format = plain,
  caption,
}: {
  labels: string[];
  series: { name: string; values: number[]; color?: string }[];
  height?: number;
  format?: (value: number) => string;
  caption: string;
}) {
  if (labels.length === 0 || series.length === 0) return <p className="chart-empty">Nothing to draw.</p>;
  const width = Math.max(240, labels.length * 36);
  const top = 8;
  const bottom = 20;
  const plotHeight = height - top - bottom;
  const totals = labels.map((_, index) => series.reduce((sum, one) => sum + Math.max(0, one.values[index] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const slot = width / labels.length;
  const barWidth = Math.min(28, slot * 0.62);
  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={caption} preserveAspectRatio="xMinYMid meet" style={{ maxHeight: height }}>
        <title>{caption}</title>
        <line x1={0} x2={width} y1={top + plotHeight + 0.5} y2={top + plotHeight + 0.5} stroke="var(--line)" />
        {labels.map((label, index) => {
          let stackTop = top + plotHeight;
          const x = index * slot + (slot - barWidth) / 2;
          return (
            <g key={`${label}-${index}`}>
              {series.map((one, seriesIndex) => {
                const value = Math.max(0, one.values[index] ?? 0);
                const barHeight = Math.round((value / max) * plotHeight);
                stackTop -= barHeight;
                return barHeight > 0 ? (
                  <rect key={one.name} className="bar" x={x} y={stackTop} width={barWidth} height={barHeight} fill={one.color ?? PALETTE[seriesIndex % PALETTE.length]} style={{ animationDelay: `${index * 25}ms` }}>
                    <title>{`${label}, ${one.name}: ${format(value)}`}</title>
                  </rect>
                ) : null;
              })}
              <text className="axis-label" x={x + barWidth / 2} y={height - 5} textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="visually-hidden">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Label</th>
            {series.map((one) => (
              <th key={one.name} scope="col">
                {one.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, index) => (
            <tr key={`${label}-${index}`}>
              <th scope="row">{label}</th>
              {series.map((one) => (
                <td key={one.name}>{format(one.values[index] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

// Horizontal bars with a label and a value on each row: latencies, balances, shares. Drawn with
// HTML rather than SVG so the labels wrap and the row stays readable at any width.
export function HBars({
  rows,
  max,
  format = plain,
  caption,
}: {
  rows: (Point & { display?: string })[];
  // The value a full bar means; defaults to the largest absolute value.
  max?: number;
  format?: (value: number) => string;
  caption: string;
}) {
  if (rows.length === 0) return <p className="chart-empty">Nothing to draw.</p>;
  const limit = Math.max(1, max ?? Math.max(...rows.map((row) => Math.abs(row.value))));
  return (
    <div className="hbars" role="img" aria-label={caption}>
      {rows.map((row, index) => (
        <div className="hbar-row" key={row.key ?? `${row.label}-${index}`}>
          <span className="hbar-label" title={row.label}>
            {row.label}
          </span>
          <span className="hbar-track">
            <span
              className="hbar-fill"
              style={{ width: `${Math.min(100, (Math.abs(row.value) / limit) * 100)}%`, ["--swatch" as string]: row.color ?? PALETTE[0], animationDelay: `${index * 30}ms` }}
            />
          </span>
          <span className="hbar-value">{row.display ?? format(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

// A donut: the share of each slice, with a figure in the middle.
export function Donut({ slices, center, format = plain, caption, size = 132 }: { slices: Point[]; center?: ReactNode; format?: (value: number) => string; caption: string; size?: number }) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  if (total === 0) return <p className="chart-empty">Nothing to draw.</p>;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <svg viewBox="0 0 100 100" role="img" aria-label={caption} style={{ width: size, height: size, flexShrink: 0 }}>
        <title>{caption}</title>
        <circle cx={50} cy={50} r={radius} fill="none" stroke="#f0f0f2" strokeWidth={12} />
        {slices.map((slice, index) => {
          const share = Math.max(0, slice.value) / total;
          const length = share * circumference;
          const element = (
            <circle
              key={slice.key ?? `${slice.label}-${index}`}
              className="arc"
              cx={50}
              cy={50}
              r={radius}
              fill="none"
              stroke={slice.color ?? PALETTE[index % PALETTE.length]}
              strokeWidth={12}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
              style={{ ["--arc-length" as string]: `${circumference}`, animationDelay: `${index * 80}ms` }}
            >
              <title>{`${slice.label}: ${format(slice.value)}`}</title>
            </circle>
          );
          offset += length;
          return element;
        })}
        {center !== undefined ? (
          <text x={50} y={50} textAnchor="middle" dominantBaseline="central" style={{ fontFamily: '"DM Sans", Inter, sans-serif', fontSize: 18, fontWeight: 500, fill: "var(--ink)" }}>
            {center}
          </text>
        ) : null}
      </svg>
      <div className="chart-legend" style={{ flexDirection: "column", gap: 4, marginTop: 0 }}>
        {slices.map((slice, index) => (
          <span key={slice.key ?? `${slice.label}-${index}`} style={{ ["--swatch" as string]: slice.color ?? PALETTE[index % PALETTE.length] }}>
            {slice.label} <b>{format(slice.value)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

// A sparkline: a small line for a trend, inside a tile or a table cell.
export function Sparkline({ points, width = 140, height = 36, color = "var(--chart-1)", caption }: { points: number[]; width?: number; height?: number; color?: string; caption: string }) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coordinates = points.map((value, index) => [index * step, height - 3 - ((value - min) / span) * (height - 6)] as const);
  const line = coordinates.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={caption} style={{ width, height }} preserveAspectRatio="none">
      <title>{caption}</title>
      <path className="area" d={area} fill={color} opacity={0.12} />
      <path className="line" d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// A swatch for a hand-written legend under a chart.
export function Swatch({ color, children }: { color?: string; children: ReactNode }) {
  return <span style={{ ["--swatch" as string]: color ?? PALETTE[0] }}>{children}</span>;
}

export const CHART_COLORS = PALETTE;
