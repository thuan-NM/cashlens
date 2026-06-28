export const dashboardMonthRange = (month?: string) => {
  const base = month ? new Date(`${month}-01T00:00:00.000Z`) : new Date();
  const from = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const to = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1),
  );

  return { from, to };
};

export const dashboardMonthsRange = (months = 6) => {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1),
  );

  return { from, to };
};

export const monthKey = (date: Date) => date.toISOString().slice(0, 7);
