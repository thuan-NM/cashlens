export function formatMoney(value: number): string {
  return `${Math.round(value).toLocaleString("vi-VN")}₫`;
}

export function formatMoneyShort(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".0", "")}tr`;
  if (absolute >= 1_000) return `${Math.round(value / 1_000)}k`;
  return formatMoney(value);
}

export function formatSign(value: number, direction: string): string {
  const sign = direction === "income" ? "+" : direction === "expense" ? "−" : "";
  return `${sign}${formatMoney(value)}`;
}
