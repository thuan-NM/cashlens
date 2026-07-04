interface SparkProps { data: number[]; color: string; width?: number; height?: number; }

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function SparkLine({ data, color, width = 120, height = 34 }: SparkProps) {
  const points = data.length ? data.map(numberOrZero) : [0, 0];
  const mn = Math.min(...points), mx = Math.max(...points), rg = (mx - mn) || 1;
  const xs = (i: number) => points.length < 2 ? width / 2 : (i / (points.length - 1)) * width;
  const ys = (v: number) => height - 2 - ((numberOrZero(v) - mn) / rg) * (height - 6);
  const ln = points.map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(" ");
  const ar = ln + ` L${width} ${height} L0 ${height} Z`;
  const gid = `sp-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={ar} fill={`url(#${gid})`} />
      <path d={ln} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs(points.length - 1)} cy={ys(points[points.length - 1])} r={2.6} fill={color} />
    </svg>
  );
}
