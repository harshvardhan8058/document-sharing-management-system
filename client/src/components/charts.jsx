import { useEffect, useRef, useState } from "react";
import {
  categoryColor,
  categoryLabel,
  formatBytes,
  formatDayLabel,
  formatNumber,
  formatUsagePercent,
} from "../lib/format";

/* ==========================================================================
   Charts — hand-drawn SVG/CSS, no charting dependency.
   Each one degrades to a readable empty state rather than an empty box.
   ========================================================================== */

/**
 * Smooth area sparkline. Used behind metric tiles.
 *
 * Sparse data is the normal case for a new instance, and it is where sparklines
 * lie: a fortnight of zeroes with one upload becomes a flat line and a cliff,
 * which reads as a rendering fault rather than as "one thing happened". A series
 * with no variation is therefore drawn as a deliberate flat baseline, and a
 * single data point gets a marker instead of a slope.
 */
export function Sparkline({ points = [], color = "#67e8f9", height = 44, fill = true }) {
  const values = points.map((point) => (typeof point === "number" ? point : point.count || 0));
  if (values.length < 2) return null;

  const width = 100;
  const step = width / (values.length - 1);
  // Breathing room top and bottom: at full height the stroke is clipped by the
  // viewBox and the peak looks cut off.
  const padding = 3;
  const usable = height - padding * 2;

  const max = Math.max(...values, 1);
  const nonZero = values.filter((value) => value > 0);
  const flat = new Set(values).size === 1;

  if (flat) {
    // Honest "nothing to show": a resting line, no fill, no implied trend.
    const y = height - padding;
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height }}
        aria-hidden="true"
      >
        <path
          d={`M 0 ${y} L ${width} ${y}`}
          fill="none"
          stroke={color}
          strokeOpacity="0.32"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const coords = values.map((value, index) => [index * step, padding + usable - (value / max) * usable]);

  // One lonely reading: a slope between zero and it implies a trend that does
  // not exist, so mark the point.
  const single = nonZero.length === 1 ? coords[values.findIndex((value) => value > 0)] : null;

  // Cardinal-ish smoothing: pull each segment through the midpoint of its neighbours.
  const path = coords.reduce((acc, [x, y], index) => {
    if (index === 0) return `M ${x} ${y}`;
    const [px, py] = coords[index - 1];
    const cx = (px + x) / 2;
    return `${acc} C ${cx} ${py}, ${cx} ${y}, ${x} ${y}`;
  }, "");

  const gradientId = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill ? (
        <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill={`url(#${gradientId})`} stroke="none" />
      ) : null}
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      {single ? <circle cx={single[0]} cy={single[1]} r="2.4" fill={color} vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}

/**
 * Daily upload volume, with a floating tooltip on the hovered column.
 *
 * The tooltip is positioned from the column's own offset rather than from mouse
 * coordinates, so it stays anchored while the pointer moves within a bar and
 * lands identically for keyboard focus.
 */
export function DayBars({ data = [] }) {
  const [hovered, setHovered] = useState(null);
  const max = Math.max(...data.map((day) => day.count), 1);

  if (!data.length) return <p className="text-sm dim">No activity yet.</p>;

  const active = hovered === null ? null : data[hovered];
  const total = data.reduce((sum, day) => sum + day.count, 0);

  return (
    <div className="col gap-3">
      <div className="row between text-xs dim">
        <span>{data.length}-day upload volume</span>
        <span className="nums">
          {formatNumber(total)} file{total === 1 ? "" : "s"} ·{" "}
          {formatBytes(data.reduce((sum, day) => sum + day.bytes, 0))}
        </span>
      </div>

      {/* Peak label, so a lone tall bar has a scale and does not read as "all of
          the activity" without a number attached to it. */}
      <div className="row between text-xs dim">
        <span className="nums">{total ? `peak ${formatNumber(max)}/day` : ""}</span>
      </div>

      <div className="bars relative" onMouseLeave={() => setHovered(null)}>
        {data.map((day, index) => (
          /* Every day is a full-height slot with the bar inside it. Sizing the
             button itself left empty days as 3%-high stubs floating on the
             baseline, which looked like a broken chart rather than a quiet
             fortnight — and gave those days almost no hit area to hover. */
          <span key={day.date} className="bars__slot">
            <button
              type="button"
              className={`bars__col ${day.count === 0 ? "bars__col--empty" : ""}`}
              style={{
                height: day.count === 0 ? "2px" : `${Math.max(6, (day.count / max) * 100)}%`,
                animationDelay: `${index * 22}ms`,
                opacity: hovered === null || hovered === index ? 1 : 0.45,
              }}
              onMouseEnter={() => setHovered(index)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              aria-label={`${formatDayLabel(day.date)}: ${day.count} file${day.count === 1 ? "" : "s"}, ${formatBytes(day.bytes)}`}
            />
          </span>
        ))}

        {active ? (
          <span
            className="chart-tip"
            style={{ left: `${((hovered + 0.5) / data.length) * 100}%`, bottom: 0 }}
          >
            <strong>{formatDayLabel(active.date)}</strong>
            <span className="dim">
              {" "}
              · {formatNumber(active.count)} file{active.count === 1 ? "" : "s"}
              {active.bytes ? ` · ${formatBytes(active.bytes)}` : ""}
            </span>
          </span>
        ) : null}
      </div>

      <div className="row between text-xs dim">
        <span>{formatDayLabel(data[0].date)}</span>
        <span>{formatDayLabel(data.at(-1).date)}</span>
      </div>
    </div>
  );
}

/**
 * Storage gauge. Animates from 0 to the real value on mount so the number
 * reads as "measured" rather than "hard-coded".
 */
export function StorageRing({ percent = 0, usedLabel, quotaLabel, size = 148, tone = "ok" }) {
  const [shown, setShown] = useState(0);
  const raf = useRef(null);

  useEffect(() => {
    const target = Math.max(0, Math.min(100, percent));
    const duration = 750;
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      // easeOutCubic
      setShown(target * (1 - (1 - progress) ** 3));
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => raf.current && cancelAnimationFrame(raf.current);
  }, [percent]);

  const stroke = 11;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - shown / 100);

  const colors = {
    ok: ["#67e8f9", "#5b8cff"],
    warning: ["#fbbf24", "#fb7185"],
    danger: ["#fb7185", "#f43f5e"],
  }[tone];

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <defs>
          <linearGradient id={`ring-${tone}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={colors[0]} />
            <stop offset="100%" stopColor={colors[1]} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--chart-ring-track)"
          strokeWidth={stroke}
        />
        {/* A gauge with nothing in it still has to look like a gauge. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#ring-${tone})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="ring__label">
        {/* "0.0%" for a real 2.6 KB reads as a broken number. Anything present
            but below a tenth of a percent is shown as such. */}
        <div className="ring__value">{formatUsagePercent(percent, shown)}</div>
        <div className="ring__unit">
          {usedLabel}
          {quotaLabel ? ` of ${quotaLabel}` : ""}
        </div>
      </div>
    </div>
  );
}

/** Horizontal breakdown by document category. */
export function CategoryBreakdown({ items = [] }) {
  if (!items.length) return <p className="text-sm dim">Upload a document to see the breakdown.</p>;

  const total = items.reduce((sum, item) => sum + item.count, 0) || 1;

  return (
    <div className="col gap-3">
      {items.map((item) => {
        const percent = (item.count / total) * 100;
        const color = categoryColor(item.name);

        return (
          <div key={item.name} className="col gap-1">
            <div className="row between text-xs">
              <span className="row gap-2 muted">
                <span className="legend__swatch" style={{ background: color }} />
                {categoryLabel(item.name)}
              </span>
              <span className="dim nums">
                {formatNumber(item.count)} · {percent.toFixed(0)}%
              </span>
            </div>
            <div className="progress">
              <div
                className="progress__fill"
                style={{ width: `${percent}%`, background: `linear-gradient(90deg, ${color}, ${color}66)` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
