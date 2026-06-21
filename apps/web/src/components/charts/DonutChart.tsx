import { useState } from "react";

interface Segment {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({ segments }: { segments: Segment[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 70;
  const center = 100;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg viewBox="0 0 200 200" width="100%" className="block max-w-[196px]">
      <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={23} />
      {segments.map((segment, index) => {
        const fraction = segment.value / total;
        const dashOffset = -offset * circumference;
        offset += fraction;
        return (
          <circle
            key={segment.label}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={hover === index ? 28 : 23}
            opacity={hover === null || hover === index ? 1 : 0.4}
            strokeDasharray={`${circumference * fraction - 2} ${circumference}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${center} ${center})`}
            strokeLinecap="round"
            className="cursor-pointer transition-all"
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          />
        );
      })}
      <text x={center} y={center - 3} textAnchor="middle" fill="var(--muted)" fontSize={10} fontFamily="Be Vietnam Pro">
        {hover === null ? "Tổng chi" : segments[hover].label}
      </text>
      <text x={center} y={center + 17} textAnchor="middle" fill={hover === null ? "var(--text)" : segments[hover].color} fontSize={16} fontWeight={700} fontFamily="Be Vietnam Pro">
        {hover === null ? "13,8tr" : `${Math.round((segments[hover].value / total) * 100)}%`}
      </text>
    </svg>
  );
}
