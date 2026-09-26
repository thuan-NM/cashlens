import type { DashboardOverview, TransactionCategory, TransactionPage } from "@repo/api-contract";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App as AntdApp, Drawer, Form, Input, Modal, Pagination, Popconfirm, Segmented, Select, Skeleton } from "antd";
import { type HttpError, useCustom, useCustomMutation, useList } from "@refinedev/core";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ApiError } from "@/api/client";
import {
  apiErrorMessage,
  apiFieldErrors,
  describeApiError,
  mapCategory,
  mapTransactionRecord,
  type CategoryEventPayload,
  type DecisionExplanation,
  type TransactionPayload,
  type TransactionRecord,
} from "@/api/mappers";
import { formatDateTime, formatMoney, formatMonthKey, formatPeriod, formatSign } from "@/utils/format";

const PAGE_SIZE = 50;
const MONTH_CHOICES = 24;
const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const CREATE_FIELDS = ["amount", "direction", "description", "categoryId"] as const;
/** The API message of a 404 about the transaction itself, not a related category, account, or original. */
const TRANSACTION_NOT_FOUND = "Transaction not found";

// API responses, from the API contract.
type TransactionListResponse = TransactionPage;
type CategoryPayload = TransactionCategory;
type OverviewResponse = Pick<DashboardOverview, "month" | "currency" | "periodStart" | "periodEnd" | "timeZone">;
type MutationValues = Record<string, unknown> | undefined;
type CreateValues = { direction: string; amount: string; description?: string; categoryId?: string };

const directionOptions = [
  { label: "Mọi loại", value: "all" },
  { label: "Thu", value: "INCOME" },
  { label: "Chi", value: "EXPENSE" },
  { label: "Chuyển vào", value: "TRANSFER_IN" },
  { label: "Chuyển ra", value: "TRANSFER_OUT" },
  { label: "Điều chỉnh", value: "ADJUSTMENT" },
];

const statusOptions = [
  { label: "Mọi trạng thái", value: "all" },
  { label: "Đã ghi nhận", value: "POSTED" },
  { label: "Chờ xử lý", value: "PENDING" },
  { label: "Cần xem lại", value: "NEEDS_REVIEW" },
  { label: "Đã bỏ qua", value: "IGNORED" },
];

const statusLabels: Record<string, string> = {
  PENDING: "Chờ xử lý",
  NEEDS_REVIEW: "Cần xem lại",
  IGNORED: "Đã bỏ qua",
};

const neutralDirectionLabels: Record<string, string> = {
  TRANSFER_IN: "Chuyển vào",
  TRANSFER_OUT: "Chuyển ra",
  ADJUSTMENT: "Điều chỉnh",
};

/** Who decided the current category (CLASS-003). */
const classificationLabels: Record<string, string> = {
  MANUAL: "Bạn đã chọn",
  USER_RULE: "Rule của bạn",
  SYSTEM_RULE: "Rule hệ thống",
  FALLBACK: "Không có rule nào khớp",
  UNKNOWN: "Chưa phân loại tự động",
};

/** What caused a category history event (CLASS-005). */
const triggerLabels: Record<string, string> = {
  CREATE: "Khi tạo giao dịch",
  IMPORT: "Khi nhập từ email",
  MANUAL_CORRECTION: "Bạn sửa nhóm",
  EXPLICIT_RECLASSIFY: "Bạn yêu cầu phân loại lại",
  AUTOMATIC_RERUN: "Hệ thống chạy lại rule",
};

const tieBreakLabels: Record<NonNullable<DecisionExplanation["tieBreak"]>, string> = {
  SCOPE: "rule của bạn được ưu tiên hơn rule hệ thống",
  PRIORITY: "mức ưu tiên cao hơn",
  CREATED_AT: "cùng mức ưu tiên, rule tạo sớm hơn",
  ID: "cùng mức ưu tiên và thời điểm tạo, mã rule nhỏ hơn",
};

/** A row the rules left without a category still needs the owner's choice (CLASS-004). */
const needsCategory = (transaction: TransactionRecord) =>
  !transaction.categoryId && (transaction.classificationSource === "FALLBACK" || transaction.classificationSource === "UNKNOWN");

/** The winner and how conflicts were settled, from the recorded explanation only. */
const describeExplanation = (explanation: DecisionExplanation | null) => {
  if (!explanation) return null;
  const winner = explanation.candidates.find((candidate) => candidate.ruleId === explanation.winnerRuleId);
  if (!winner) return "Không có rule nào khớp: giao dịch để trống nhóm để bạn xem lại.";
  const parts = [
    `${explanation.candidates.length} rule khớp; chọn ${winner.scope === "USER" ? "rule của bạn" : "rule hệ thống"} (ưu tiên ${winner.priority})`,
  ];
  if (explanation.candidates.length > 1 && explanation.tieBreak) parts.push(`vì ${tieBreakLabels[explanation.tieBreak]}`);
  if (explanation.conflict) parts.push("các rule khớp gợi ý nhóm khác nhau");
  return parts.join(" · ");
};

const eventCategoryName = (category: CategoryEventPayload["previousCategory"]) =>
  category ? (category.name ?? "Nhóm không còn truy cập được") : "Chưa phân loại";

/** Month keys ending at `last`, newest first, by YYYY-MM arithmetic only. */
const monthKeysEndingAt = (last: string, count: number) => {
  const [year, month] = last.split("-").map(Number);
  if (!year || !month) return [last];
  return Array.from({ length: count }, (_, index) => {
    const serial = year * 12 + (month - 1) - index;
    return `${Math.floor(serial / 12)}-${String((serial % 12) + 1).padStart(2, "0")}`;
  });
};

/** Why a row does not add to income/expense, per the documented policy; totals come from the API. */
const exclusionNote = (transaction: TransactionRecord) => {
  if (statusLabels[transaction.status]) return `Không tính vào tổng: trạng thái "${statusLabels[transaction.status]}".`;
  if (transaction.isDuplicate) return "Không tính vào tổng: đã đánh dấu trùng lặp.";
  if (neutralDirectionLabels[transaction.direction]) return "Được hiển thị nhưng không tính vào thu, chi và dòng tiền ròng.";
  return null;
};

const isExcludedFromTotals = (transaction: TransactionRecord) =>
  Boolean(statusLabels[transaction.status]) || transaction.isDuplicate;

const EmptyBlock = ({ text }: { text: string }) => (
  <div className="p-8 text-center text-[12px] text-[var(--muted)]">{text}</div>
);

const ErrorBlock = ({ text, onRetry, retrying }: { text: string; onRetry: () => void; retrying?: boolean }) => (
  <div className="flex flex-col items-center gap-3 p-8 text-center text-[12px] text-[var(--muted)]">
    <span>{text}</span>
    <Button onClick={onRetry} disabled={retrying}>
      {retrying ? "Đang thử lại..." : "Thử lại"}
    </Button>
  </div>
);

function StateBadges({ transaction }: { transaction: TransactionRecord }) {
  return (
    <>
      {statusLabels[transaction.status] && <Badge color="#d99a3c">{statusLabels[transaction.status]}</Badge>}
      {transaction.isDuplicate && <Badge color="#d2604c">Trùng lặp</Badge>}
      {needsCategory(transaction) && <Badge color="#8a8378">Cần chọn nhóm</Badge>}
      {neutralDirectionLabels[transaction.direction] && (
        <Badge color="#5b8def">{neutralDirectionLabels[transaction.direction]}</Badge>
      )}
    </>
  );
}

export function TransactionsPage() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<CreateValues>();
  const [monthChoice, setMonthChoice] = useState<string>();
  const [direction, setDirection] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TransactionRecord | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [duplicateTarget, setDuplicateTarget] = useState<string>();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErrors, setCreateErrors] = useState<string[]>([]);
  const busy = useRef(false);
  // The transaction the drawer shows now; an action's response may arrive after it changed.
  const shownId = useRef<string | null>(null);
  useEffect(() => {
    shownId.current = selected?.id ?? null;
  }, [selected]);

  // The current user month, base currency, and account time zone, exactly as the
  // dashboard sees them. Presence is read from the React Query data: refine's
  // `result.data` is a frozen `{}` while pending or failed.
  const { query: overviewQuery } = useCustom<OverviewResponse>({ url: "/dashboard/overview", method: "get" });
  const overview = overviewQuery.data?.data;
  const month = monthChoice ?? overview?.month;
  const baseCurrency = overview?.currency;
  const timeZone = overview?.timeZone ?? undefined;

  const { query: categoryQuery } = useList<CategoryPayload>({ resource: "transaction-categories", pagination: { mode: "off" } });
  const categories = useMemo(() => categoryQuery.data?.data.map(mapCategory) ?? [], [categoryQuery.data]);

  const { query: listQuery } = useCustom<TransactionListResponse>({
    url: "/transactions",
    method: "get",
    config: {
      query: {
        month,
        direction: direction === "all" ? undefined : direction,
        categoryId: category === "all" ? undefined : category,
        status: status === "all" ? undefined : status,
        search: search || undefined,
        page,
        limit: PAGE_SIZE,
      },
    },
    queryOptions: { enabled: Boolean(month), placeholderData: (previous) => previous },
  });
  const listData = listQuery.data?.data;
  const totals = listData?.totals;
  const rows = useMemo(
    () => (listData?.data ?? []).map((item) => mapTransactionRecord(item, timeZone)),
    [listData, timeZone],
  );
  const otherCurrencies = totals ? totals.currencies.filter((group) => group.currency !== totals.currency) : [];
  const filtersActive = direction !== "all" || category !== "all" || status !== "all" || Boolean(search);
  const monthOptions = overview?.month
    ? monthKeysEndingAt(overview.month, MONTH_CHOICES).map((key) => ({ label: `Tháng ${formatMonthKey(key)}`, value: key }))
    : [];

  // The open transaction's append-only category history (CLASS-005).
  const { query: historyQuery } = useCustom<CategoryEventPayload[]>({
    url: `/transactions/${selected?.id ?? "none"}/category-history`,
    method: "get",
    queryOptions: { enabled: Boolean(selected) },
  });
  // refine keeps the previous query's data as a placeholder: that is another transaction's history.
  const historyEvents = historyQuery.isPlaceholderData ? undefined : historyQuery.data?.data;
  const historyRefreshFailed = Boolean(historyEvents) && historyQuery.isError && !historyQuery.isFetching;

  const { mutateAsync: send } = useCustomMutation<TransactionPayload, HttpError, MutationValues>();

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const openDetail = (transaction: TransactionRecord) => {
    setSelected(transaction);
    setNoteDraft(transaction.userNote);
    setDuplicateTarget(undefined);
  };

  /** Closes the drawer only while it still shows this transaction. */
  const closeDetail = (transactionId: string) =>
    setSelected((current) => (current && current.id === transactionId ? null : current));

  /** One drawer action at a time; a pending request disables every action (no duplicate submits). */
  const runAction = async (
    key: string,
    transactionId: string,
    request: { url: string; method: "patch" | "post" | "delete"; values?: Record<string, unknown> },
    successText: string,
  ) => {
    if (busy.current) return undefined;
    busy.current = true;
    setPendingAction(key);
    try {
      const response = await send({ url: request.url, method: request.method, values: request.values });
      message.success(successText);
      void listQuery.refetch();
      return response.data;
    } catch (error) {
      const notFound = error instanceof ApiError && error.status === 404;
      const apiText = apiErrorMessage(error);
      if (notFound && apiText === TRANSACTION_NOT_FOUND) {
        // The transaction itself is gone: close its drawer and reload the list.
        message.error(describeApiError(error));
        closeDetail(transactionId);
        void listQuery.refetch();
      } else if (notFound) {
        // A related category, original transaction, or account is missing; the drawer stays open.
        message.error(apiText ? `Không tìm thấy dữ liệu liên quan: ${apiText}` : describeApiError(error));
      } else {
        message.error(describeApiError(error));
      }
      return undefined;
    } finally {
      busy.current = false;
      setPendingAction(null);
    }
  };

  /** Shows an action's result only if the drawer still shows that transaction. */
  const applyUpdate = (data: TransactionPayload | undefined) => {
    if (!data) return;
    const updated = mapTransactionRecord(data, timeZone);
    setSelected((current) => (current && current.id === updated.id ? updated : current));
    if (shownId.current !== updated.id) return;
    setNoteDraft(updated.userNote);
    setDuplicateTarget(undefined);
  };

  /** Reloads the history only while the drawer still shows that transaction (never the "none" URL). */
  const refreshHistory = (data: TransactionPayload | undefined, transactionId: string) => {
    if (data && shownId.current === transactionId) void historyQuery.refetch();
  };

  const changeCategory = async (transaction: TransactionRecord, value: string) => {
    const data = await runAction(
      "category",
      transaction.id,
      { url: `/transactions/${transaction.id}/category`, method: "patch", values: { categoryId: value === "none" ? null : value } },
      "Đã cập nhật nhóm giao dịch",
    );
    applyUpdate(data);
    refreshHistory(data, transaction.id);
  };

  /** Explicit reclassification (CLASS-006): the confirmation warns first. */
  const reclassify = async (transaction: TransactionRecord) => {
    const data = await runAction(
      "reclassify",
      transaction.id,
      { url: `/transactions/${transaction.id}/reclassify`, method: "post", values: {} },
      "Đã phân loại lại giao dịch theo rule hiện tại",
    );
    applyUpdate(data);
    refreshHistory(data, transaction.id);
  };

  const saveNote = async (transaction: TransactionRecord) => {
    const data = await runAction(
      "note",
      transaction.id,
      { url: `/transactions/${transaction.id}`, method: "patch", values: { userNote: noteDraft } },
      "Đã lưu ghi chú",
    );
    applyUpdate(data);
  };

  const ignore = async (transaction: TransactionRecord) => {
    const data = await runAction(
      "ignore",
      transaction.id,
      { url: `/transactions/${transaction.id}/ignore`, method: "patch", values: {} },
      "Đã bỏ qua giao dịch; giao dịch không còn được tính vào tổng",
    );
    applyUpdate(data);
  };

  const markDuplicate = async (transaction: TransactionRecord, originalId: string) => {
    const data = await runAction(
      "duplicate",
      transaction.id,
      { url: `/transactions/${transaction.id}/duplicate`, method: "patch", values: { duplicateOfTransactionId: originalId } },
      "Đã đánh dấu giao dịch trùng lặp",
    );
    applyUpdate(data);
  };

  const clearDuplicate = async (transaction: TransactionRecord) => {
    const data = await runAction(
      "duplicate",
      transaction.id,
      { url: `/transactions/${transaction.id}/duplicate`, method: "patch", values: {} },
      "Đã bỏ đánh dấu trùng lặp",
    );
    applyUpdate(data);
  };

  const remove = async (transaction: TransactionRecord) => {
    const data = await runAction(
      "delete",
      transaction.id,
      { url: `/transactions/${transaction.id}`, method: "delete" },
      "Đã xóa giao dịch",
    );
    if (!data) return;
    closeDetail(transaction.id);
    if (rows.length === 1 && page > 1) setPage(page - 1);
  };

  const closeModal = () => {
    if (creating) return;
    setModalOpen(false);
    setCreateErrors([]);
    form.resetFields();
  };

  const submitManual = async (values: CreateValues) => {
    if (busy.current || !baseCurrency) return;
    busy.current = true;
    setCreating(true);
    setCreateErrors([]);
    try {
      await send({
        url: "/transactions",
        method: "post",
        values: {
          amount: Number(String(values.amount).trim().replace(",", ".")),
          currency: baseCurrency,
          direction: values.direction,
          transactionTime: new Date().toISOString(),
          description: values.description?.trim() || undefined,
          categoryId: values.categoryId || undefined,
        },
      });
      message.success("Đã thêm giao dịch vào tháng hiện tại");
      setModalOpen(false);
      form.resetFields();
      // A new transaction is dated now, so show the current user month; a
      // changed month or page refetches through the query key.
      const showingCurrentMonth = month === overview?.month && page === 1;
      setMonthChoice(undefined);
      setPage(1);
      void overviewQuery.refetch();
      if (showingCurrentMonth) void listQuery.refetch();
    } catch (error) {
      const { fieldErrors, otherErrors } = apiFieldErrors(error, CREATE_FIELDS);
      form.setFields(Object.entries(fieldErrors).map(([name, errors]) => ({ name: name as keyof CreateValues, errors })));
      setCreateErrors(otherErrors);
    } finally {
      busy.current = false;
      setCreating(false);
    }
  };

  if (!month) {
    return (
      <Card>
        {overviewQuery.isError ? (
          <ErrorBlock
            text={`Không thể xác định tháng hiện tại. ${describeApiError(overviewQuery.error)}`}
            onRetry={() => void overviewQuery.refetch()}
            retrying={overviewQuery.isFetching}
          />
        ) : (
          <Skeleton active paragraph={{ rows: 6 }} />
        )}
      </Card>
    );
  }

  // No data yet and no failure is loading, whatever the fetch status (pending, paused, or first render).
  const listFailed = !listData && listQuery.isError;
  const listLoading = !listData && !listFailed;
  const refreshFailed = Boolean(listData) && listQuery.isError && !listQuery.isFetching;
  const stale = listQuery.isPlaceholderData;
  const summary: Array<[string, number | undefined, string]> = [
    ["Tổng thu", totals?.income, "var(--income)"],
    ["Tổng chi", totals?.expense, "var(--expense)"],
    ["Dòng tiền ròng", totals?.netCashflow, "var(--accent)"],
  ];
  const actionsDisabled = pendingAction !== null;
  const duplicateOptions = selected
    ? rows
        .filter((row) => row.id !== selected.id)
        .map((row) => ({ label: `${row.desc} · ${row.time} · ${formatMoney(row.amount, row.currency)}`, value: row.id }))
    : [];
  // The recorded reason for the current rule decision: the latest event, when it made that decision.
  const latestEvent = historyEvents?.[historyEvents.length - 1];
  const latestDecision =
    selected && latestEvent && latestEvent.source === selected.classificationSource
      ? describeExplanation(latestEvent.explanation)
      : null;
  const duplicateOriginal = selected?.duplicateOfTransactionId
    ? rows.find((row) => row.id === selected.duplicateOfTransactionId)
    : undefined;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {summary.map(([label, value, color]) => (
          <Card key={label}>
            <div className="text-[11.5px] text-[var(--muted)]">{label}</div>
            {value === undefined ? (
              listFailed ? (
                <div className="mt-2 text-[22px] font-bold text-[var(--faint)]">—</div>
              ) : (
                <Skeleton.Input active size="small" className="mt-2" />
              )
            ) : (
              <div className={`mt-2 text-[22px] font-bold tabular-nums ${stale ? "opacity-50" : ""}`} style={{ color }}>
                {formatMoney(value, totals?.currency)}
              </div>
            )}
          </Card>
        ))}
      </div>
      {totals && listData && (
        <div className="space-y-0.5 px-1 text-[11px] text-[var(--faint)]">
          <p>
            Tháng {formatMonthKey(month)}
            {month === overview?.month && ` (${formatPeriod(overview.periodStart, overview.periodEnd, timeZone)})`} · tổng của tất cả{" "}
            {listData.total} giao dịch khớp bộ lọc, không chỉ trang này · {totals.transactionCount} giao dịch được tính (mọi loại, mọi tiền tệ).
          </p>
          <p>
            Giao dịch chờ xử lý, cần xem lại, đã bỏ qua hoặc trùng lặp không được tính; chuyển khoản và điều chỉnh không tính vào thu, chi và
            dòng tiền ròng.
          </p>
        </div>
      )}
      {otherCurrencies.length > 0 && (
        <Card padding="p-3 sm:p-4">
          <div className="text-[11.5px] font-semibold text-[var(--muted)]">Tiền tệ khác (không cộng vào tổng {totals?.currency})</div>
          <div className="mt-2 space-y-1 text-[12px]">
            {otherCurrencies.map((group) => (
              <div key={group.currency} className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                <b>{group.currency}</b>
                <span className="text-[var(--income)]">Thu {formatMoney(group.income, group.currency)}</span>
                <span className="text-[var(--expense)]">Chi {formatMoney(group.expense, group.currency)}</span>
                <span>Ròng {formatMoney(group.netCashflow, group.currency)}</span>
                <span className="text-[var(--faint)]">{group.transactionCount} giao dịch</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card padding="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select className="min-w-[150px]" value={month} onChange={resetPage(setMonthChoice)} options={monthOptions} aria-label="Tháng" />
          <Select className="min-w-[140px]" value={direction} onChange={resetPage(setDirection)} options={directionOptions} aria-label="Loại giao dịch" />
          <Select
            className="min-w-[170px]"
            value={category}
            onChange={resetPage(setCategory)}
            options={[{ label: "Tất cả nhóm", value: "all" }, ...categories.map((item) => ({ label: item.name, value: item.id }))]}
            aria-label="Nhóm"
          />
          <Select className="min-w-[150px]" value={status} onChange={resetPage(setStatus)} options={statusOptions} aria-label="Trạng thái" />
          <Input.Search
            className="max-w-[240px]"
            allowClear
            maxLength={200}
            placeholder="Tìm mô tả, người bán..."
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onSearch={(value) => resetPage(setSearch)(value.trim())}
          />
          <div className="ml-auto flex gap-2">
            <Button variant="primary" icon={<Icon name="plus" width={15} />} onClick={() => setModalOpen(true)} disabled={!baseCurrency}>
              Thêm giao dịch
            </Button>
          </div>
        </div>
      </Card>
      {refreshFailed && (
        <Alert
          type="warning"
          showIcon
          message={`Không thể làm mới danh sách. ${describeApiError(listQuery.error)}`}
          action={<Button onClick={() => void listQuery.refetch()}>Thử lại</Button>}
        />
      )}
      <Card padding="p-0" className="overflow-hidden">
        <div className="hidden grid-cols-[1fr_150px_90px_150px] gap-3 border-b border-[var(--border)] px-5 py-3 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--faint)] md:grid">
          <span>Giao dịch</span>
          <span>Nhóm</span>
          <span>Ngân hàng</span>
          <span className="text-right">Số tiền</span>
        </div>
        {listLoading ? (
          <div className="p-5">
            <Skeleton active paragraph={{ rows: 5 }} />
          </div>
        ) : listFailed ? (
          <ErrorBlock
            text={`Không thể tải giao dịch. ${describeApiError(listQuery.error)}`}
            onRetry={() => void listQuery.refetch()}
            retrying={listQuery.isFetching}
          />
        ) : rows.length ? (
          <div className={`divide-y divide-[var(--border)] ${stale ? "opacity-60" : ""}`}>
            {rows.map((transaction) => {
              const color = transaction.categoryColor ?? "#8a8378";
              return (
                <button
                  key={transaction.id}
                  onClick={() => openDetail(transaction)}
                  className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)] md:grid-cols-[1fr_150px_90px_150px] md:px-5 ${isExcludedFromTotals(transaction) ? "opacity-60" : ""}`}
                  title={exclusionNote(transaction) ?? undefined}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="h-9 w-9 shrink-0 rounded-[10px]" style={{ background: `${color}22` }} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate text-[12px] font-semibold">{transaction.desc}</span>
                        <StateBadges transaction={transaction} />
                      </div>
                      <div className="text-[10.5px] text-[var(--faint)]">
                        {transaction.time} · {transaction.merchant}
                      </div>
                    </div>
                  </div>
                  <span className="hidden items-center gap-2 text-[11.5px] md:flex">
                    <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                    {transaction.categoryName ?? "Chưa phân loại"}
                  </span>
                  <span className="hidden text-[11.5px] text-[var(--muted)] md:block">{transaction.bank}</span>
                  <span
                    className="text-right text-[12px] font-bold tabular-nums"
                    style={{ color: transaction.flow === "income" ? "var(--income)" : "var(--text)" }}
                  >
                    {formatSign(transaction.amount, transaction.flow, transaction.currency)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyBlock
            text={
              filtersActive
                ? "Không có giao dịch khớp bộ lọc trong tháng này."
                : `Chưa có giao dịch trong tháng ${formatMonthKey(month)}. Hãy thêm giao dịch thủ công hoặc đồng bộ email.`
            }
          />
        )}
        {listData && listData.total > PAGE_SIZE && (
          <div className="flex justify-end border-t border-[var(--border)] px-4 py-3">
            <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={listData.total} showSizeChanger={false} onChange={setPage} />
          </div>
        )}
      </Card>
      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Chi tiết giao dịch" width={440}>
        {selected && (
          <div className="space-y-5">
            <div className="rounded-2xl bg-[var(--surface-2)] p-5 text-center">
              <div className="text-[12px] text-[var(--muted)]">{selected.desc}</div>
              <div className="mt-2 text-[28px] font-bold tabular-nums">{formatSign(selected.amount, selected.flow, selected.currency)}</div>
              <div className="mt-1 text-[11px] text-[var(--faint)]">
                {selected.time} · {selected.merchant} · {selected.bank}
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                <StateBadges transaction={selected} />
              </div>
            </div>
            {exclusionNote(selected) && <Alert type="info" showIcon message={exclusionNote(selected)} />}
            <div>
              <div className="mb-1.5 text-[11.5px] font-semibold text-[var(--muted)]">Nhóm</div>
              <Select
                className="w-full"
                value={selected.categoryId ?? "none"}
                disabled={actionsDisabled}
                loading={pendingAction === "category"}
                onChange={(value) => void changeCategory(selected, value)}
                options={[
                  { label: "Chưa phân loại", value: "none" },
                  ...(selected.categoryId && !categories.some((item) => item.id === selected.categoryId)
                    ? [{ label: selected.categoryName ?? "Nhóm hiện tại", value: selected.categoryId }]
                    : []),
                  ...categories.map((item) => ({ label: item.name, value: item.id })),
                ]}
              />
              <div className="mt-2 space-y-1 text-[11px] text-[var(--muted)]">
                <div>
                  Nguồn: <b>{classificationLabels[selected.classificationSource] ?? selected.classificationSource}</b>
                </div>
                {selected.classificationSource === "MANUAL" ? (
                  <div className="text-[var(--faint)]">Nhóm do bạn chọn được giữ nguyên khi hệ thống chạy lại rule tự động.</div>
                ) : selected.classificationSource === "UNKNOWN" ? (
                  <div className="text-[var(--faint)]">Giao dịch chưa được rule phân loại (phân loại tự động đang tắt hoặc giao dịch có từ trước).</div>
                ) : (
                  latestDecision && <div className="text-[var(--faint)]">{latestDecision}</div>
                )}
              </div>
              <div className="mt-2 flex justify-end">
                <Popconfirm
                  title="Phân loại lại theo rule?"
                  description={
                    <div className="max-w-[260px]">
                      {selected.classificationSource === "MANUAL"
                        ? "Nhóm bạn đã chọn sẽ bị thay bằng kết quả của rule hiện tại, hoặc để trống nếu không rule nào khớp."
                        : "Rule hiện tại sẽ được áp dụng lại và nhóm có thể thay đổi."}{" "}
                      Thay đổi được ghi vào lịch sử phân loại.
                    </div>
                  }
                  okText="Phân loại lại"
                  okButtonProps={{ danger: selected.classificationSource === "MANUAL" }}
                  cancelText="Hủy"
                  disabled={actionsDisabled}
                  onConfirm={() => reclassify(selected)}
                >
                  <Button disabled={actionsDisabled}>{pendingAction === "reclassify" ? "Đang phân loại..." : "Phân loại lại"}</Button>
                </Popconfirm>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[11.5px] font-semibold text-[var(--muted)]">Lịch sử phân loại</div>
              {historyRefreshFailed && (
                <Alert
                  className="mb-2"
                  type="warning"
                  showIcon
                  message={`Không thể làm mới lịch sử; đang hiển thị bản cũ. ${describeApiError(historyQuery.error)}`}
                  action={<Button onClick={() => void historyQuery.refetch()}>Thử lại</Button>}
                />
              )}
              {historyEvents ? (
                historyEvents.length ? (
                  <ol className="space-y-2">
                    {[...historyEvents].reverse().map((event) => (
                      <li key={event.id} className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[11.5px]">
                        <div className="flex flex-wrap justify-between gap-2">
                          <b>{triggerLabels[event.trigger] ?? event.trigger}</b>
                          <span className="text-[var(--faint)]">{formatDateTime(event.createdAt, timeZone)}</span>
                        </div>
                        <div>
                          {eventCategoryName(event.previousCategory)} → {eventCategoryName(event.newCategory)}
                        </div>
                        <div className="text-[var(--faint)]">
                          {classificationLabels[event.source] ?? event.source}
                          {event.explanation && ` · ${describeExplanation(event.explanation)}`}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-[11.5px] text-[var(--faint)]">
                    Chưa có thay đổi nhóm nào được ghi lại. Lịch sử bắt đầu từ khi tính năng phân loại theo rule được bật.
                  </div>
                )
              ) : historyQuery.isError ? (
                <ErrorBlock
                  text={`Không thể tải lịch sử phân loại. ${describeApiError(historyQuery.error)}`}
                  onRetry={() => void historyQuery.refetch()}
                  retrying={historyQuery.isFetching}
                />
              ) : (
                <Skeleton active title={false} paragraph={{ rows: 2 }} />
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[11.5px] font-semibold text-[var(--muted)]">Ghi chú</div>
              <Input.TextArea
                placeholder="Ghi chú cho giao dịch..."
                rows={4}
                value={noteDraft}
                disabled={actionsDisabled}
                onChange={(event) => setNoteDraft(event.target.value)}
              />
              <div className="mt-2 flex justify-end">
                <Button onClick={() => void saveNote(selected)} disabled={actionsDisabled || noteDraft === selected.userNote}>
                  {pendingAction === "note" ? "Đang lưu..." : "Lưu ghi chú"}
                </Button>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[11.5px] font-semibold text-[var(--muted)]">Trùng lặp</div>
              {selected.isDuplicate ? (
                <div className="flex flex-wrap items-center justify-between gap-3 text-[12px]">
                  <span>
                    Trùng với:{" "}
                    <b>{duplicateOriginal ? `${duplicateOriginal.desc} · ${duplicateOriginal.time}` : "một giao dịch khác"}</b>
                  </span>
                  <Button onClick={() => void clearDuplicate(selected)} disabled={actionsDisabled}>
                    {pendingAction === "duplicate" ? "Đang lưu..." : "Bỏ đánh dấu trùng"}
                  </Button>
                </div>
              ) : duplicateOptions.length ? (
                <div className="flex gap-2">
                  <Select
                    className="min-w-0 flex-1"
                    placeholder="Chọn giao dịch gốc trong danh sách"
                    value={duplicateTarget}
                    onChange={setDuplicateTarget}
                    options={duplicateOptions}
                    disabled={actionsDisabled}
                    showSearch
                    optionFilterProp="label"
                  />
                  <Button
                    onClick={() => duplicateTarget && void markDuplicate(selected, duplicateTarget)}
                    disabled={actionsDisabled || !duplicateTarget}
                  >
                    {pendingAction === "duplicate" ? "Đang lưu..." : "Đánh dấu trùng"}
                  </Button>
                </div>
              ) : (
                <div className="text-[11.5px] text-[var(--faint)]">Không có giao dịch khác trong danh sách để đánh dấu trùng.</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
              <Popconfirm
                title="Bỏ qua giao dịch này?"
                description="Giao dịch vẫn hiển thị nhưng không còn được tính vào tổng."
                okText="Bỏ qua"
                cancelText="Hủy"
                disabled={actionsDisabled || selected.status === "IGNORED"}
                onConfirm={() => ignore(selected)}
              >
                <Button disabled={actionsDisabled || selected.status === "IGNORED"}>
                  {pendingAction === "ignore" ? "Đang lưu..." : selected.status === "IGNORED" ? "Đã bỏ qua" : "Bỏ qua giao dịch"}
                </Button>
              </Popconfirm>
              <Popconfirm
                title="Xóa giao dịch này?"
                description="Giao dịch bị xóa sẽ không còn hiển thị và không được tính vào tổng."
                okText="Xóa"
                okButtonProps={{ danger: true }}
                cancelText="Hủy"
                disabled={actionsDisabled}
                onConfirm={() => remove(selected)}
              >
                <Button disabled={actionsDisabled} className="text-[var(--expense)]">
                  {pendingAction === "delete" ? "Đang xóa..." : "Xóa giao dịch"}
                </Button>
              </Popconfirm>
            </div>
          </div>
        )}
      </Drawer>
      <Modal title="Thêm giao dịch thủ công" open={modalOpen} onCancel={closeModal} footer={null} maskClosable={!creating}>
        <Form form={form} layout="vertical" onFinish={submitManual} disabled={creating}>
          {createErrors.length > 0 && (
            <Alert className="mb-4" type="error" showIcon message={createErrors.map((text) => <div key={text}>{text}</div>)} />
          )}
          <Form.Item label="Loại" name="direction" initialValue="EXPENSE">
            <Segmented
              block
              options={[
                { label: "Chi", value: "EXPENSE" },
                { label: "Thu", value: "INCOME" },
                { label: "Chuyển ra", value: "TRANSFER_OUT" },
                { label: "Chuyển vào", value: "TRANSFER_IN" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="Số tiền"
            name="amount"
            rules={[
              { required: true, message: "Nhập số tiền" },
              {
                validator: (_, value) => {
                  const text = String(value ?? "").trim();
                  if (!text) return Promise.resolve();
                  if (!AMOUNT_PATTERN.test(text)) {
                    return Promise.reject(new Error("Nhập số dương, tối đa 2 chữ số thập phân, không dùng dấu phân cách hàng nghìn"));
                  }
                  if (Number(text.replace(",", ".")) <= 0) return Promise.reject(new Error("Số tiền phải lớn hơn 0"));
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input inputMode="decimal" suffix={baseCurrency} placeholder="0" />
          </Form.Item>
          <Form.Item label="Mô tả" name="description">
            <Input placeholder="VD: Cơm trưa văn phòng" />
          </Form.Item>
          <Form.Item label="Nhóm" name="categoryId">
            <Select allowClear placeholder="Chưa phân loại" options={categories.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <p className="mb-4 text-[11px] text-[var(--faint)]">
            Giao dịch được ghi nhận bằng {baseCurrency} (tiền tệ gốc của tài khoản) tại thời điểm hiện tại.
          </p>
          <Button type="submit" variant="primary" className="w-full" disabled={creating}>
            {creating ? "Đang thêm..." : "Thêm giao dịch"}
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
