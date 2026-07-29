import { useEffect, useRef, useState } from "react";
import { categoryColor, categoryLabel, formatBytes, formatDayLabel, formatNumber } from "../lib/format";

/* ==========================================================================
   Charts — hand-drawn SVG/CSS, no charting dependency.
   Each one degrades to a readable empty state rather than an empty box.
   ========================================================================== */

/** Smooth area sparkline. Used behind metric tiles. */
export function Sparkline({ points = [], color = "#67e8f9", height = 44, fill = true }) {
  const values = points.map((point) => (typeof point === "number" ? point : point.count || 0));
  if (values.length < 2) return null;

  const max = Math.max(...values, 1);
  const width = 100;
  const step = width / (values.length - 1);

  const coords = values.map((value, index) => [index * step, height - (value / max) * (height - 4) - 2]);

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
    </svg>
  );
}

/** Daily upload volume. Hovering a column reveals its exact value. */
export function DayBars({ data = [] }) {
  const [hovered, setHovered] = useState(null);
  const max = Math.max(...data.map((day) => day.count), 1);

  if (!data.length) return <p className="text-sm dim">No activity yet.</p>;

  const active = hovered === null ? null : data[hovered];

  return (
    <div className="col gap-3">
      <div className="row between text-xs dim">
        <span>{data.length}-day upload volume</span>
        <span className="nums">
          {active
            ? `${formatDayLabel(active.date)} · ${formatNumber(active.count)} file${active.count === 1 ? "" : "s"} · ${formatBytes(active.bytes)}`
            : `${formatNumber(data.reduce((sum, day) => sum + day.count, 0))} total`}
        </span>
      </div>

      <div className="bars" onMouseLeave={() => setHovered(null)}>
        {data.map((day, index) => (
          <div
            key={day.date}
            className={`bars__col ${day.count === 0 ? "bars__col--empty" : ""}`}
            style={{
              height: `${Math.max(day.count === 0 ? 3 : 8, (day.count / max) * 100)}%`,
              animationDelay: `${index * 22}ms`,
              opacity: hovered === null || hovered === index ? 1 : 0.45,
            }}
            onMouseEnter={() => setHovered(index)}
            title={`${formatDayLabel(day.date)}: ${day.count}`}
          />
        ))}
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
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
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
        <div className="ring__value">{shown.toFixed(shown < 10 ? 1 : 0)}%</div>
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
