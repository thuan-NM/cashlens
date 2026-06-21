interface SparkProps { data: number[]; color: string; width?: number; height?: number; }

export function SparkLine({ data, color, width = 120, height = 34 }: SparkProps) {
  const mn = Math.min(...data), mx = Math.max(...data), rg = (mx - mn) || 1;
  const xs = (i: number) => data.length < 2 ? width / 2 : (i / (data.length - 1)) * width;
  const ys = (v: number) => height - 2 - ((v - mn) / rg) * (height - 6);
  const ln = data.map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(" ");
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
      <circle cx={xs(data.length - 1)} cy={ys(data[data.length - 1])} r={2.6} fill={color} />
    </svg>
  );
}
