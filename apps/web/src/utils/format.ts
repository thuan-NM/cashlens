const DEFAULT_CURRENCY = "VND";

/**
 * Money in the given ISO 4217 currency. Without a currency (or with VND) the
 * output is the historical rounded "₫" format, so existing callers are unchanged.
 */
export function formatMoney(value: number, currency?: string): string {
  if (!currency || currency === DEFAULT_CURRENCY) {
    return `${Math.round(value).toLocaleString("vi-VN")}₫`;
  }
  try {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(value);
  } catch {
    return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

export function formatMoneyShort(value: number, currency?: string): string {
  if (currency && currency !== DEFAULT_CURRENCY) return formatMoney(value, currency);
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".0", "")}tr`;
  if (absolute >= 1_000) return `${Math.round(value / 1_000)}k`;
  return formatMoney(value);
}

export function formatSign(value: number, direction: string, currency?: string): string {
  const sign = direction === "income" ? "+" : direction === "expense" ? "−" : "";
  return `${sign}${formatMoney(value, currency)}`;
}

/** "2026-09" -> "09/2026"; a month key names the local month in which the user month starts. */
export function formatMonthKey(month: string): string {
  const [year, monthNumber] = month.split("-");
  return year && monthNumber ? `${monthNumber}/${year}` : month;
}

const withTimeZone = <T extends Intl.DateTimeFormatOptions>(options: T, timeZone?: string): T => {
  if (!timeZone) return options;
  try {
    new Intl.DateTimeFormat("vi-VN", { timeZone });
    return { ...options, timeZone };
  } catch {
    return options;
  }
};

/** An instant shown in the account time zone when known, otherwise the browser's. */
export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN", withTimeZone({ dateStyle: "short", timeStyle: "short" }, timeZone));
}

/** A user month's inclusive date range; periodEnd is exclusive. */
export function formatPeriod(periodStart: string | undefined, periodEnd: string | undefined, timeZone?: string): string {
  if (!periodStart || !periodEnd) return "";
  const start = new Date(periodStart);
  const lastInstant = new Date(new Date(periodEnd).getTime() - 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(lastInstant.getTime())) return "";
  const options = withTimeZone({ day: "2-digit", month: "2-digit", year: "numeric" } as const, timeZone);
  return `${start.toLocaleDateString("vi-VN", options)} – ${lastInstant.toLocaleDateString("vi-VN", options)}`;
}
