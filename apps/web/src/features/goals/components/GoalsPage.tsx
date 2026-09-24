import { useMemo, useState } from "react";
import { Alert, App as AntdApp, Form, Input, Modal, Skeleton, Slider } from "antd";
import { type HttpError, useCustom, useCustomMutation, useList } from "@refinedev/core";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { apiFieldErrors, describeApiError, mapGoal } from "@/api/mappers";
import type { Goal, GoalFeasibility, GoalFeasibilityStatus, GoalHorizonSource } from "@/types/goal";
import { formatMoney, formatMoneyShort, formatMonthKey } from "@/utils/format";

const CREATE_FIELDS = ["name", "type", "targetAmount", "savedAmount", "targetDate", "months"] as const;
const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const WHAT_IF_MAX = 36;

type CreateValues = { name: string; type?: string; targetAmount: string; savedAmount?: string; targetDate?: string; months?: string };
/** A what-if horizon applies only to the goal it was chosen for. */
type WhatIf = { goalId: string; months: number };

/** The GOAL-004 levels, exactly as the API reports them. */
const levels: Record<GoalFeasibilityStatus, { label: string; color: string }> = {
  SAFE: { label: "An toàn", color: "var(--income)" },
  ACCEPTABLE: { label: "Chấp nhận được", color: "var(--accent)" },
  RISKY: { label: "Rủi ro", color: "var(--warn)" },
  NOT_RECOMMENDED: { label: "Không khuyến nghị", color: "var(--expense)" },
  INSUFFICIENT_DATA: { label: "Chưa đủ dữ liệu", color: "var(--muted)" },
};

/** Where the deadline month comes from (`horizonSource`, GOAL-002). */
const horizonLabels: Record<GoalHorizonSource, string> = {
  QUERY: "thời hạn bạn đang thử",
  TARGET_DATE: "theo ngày hoàn thành của mục tiêu",
  GOAL_MONTHS: "theo số tháng đặt khi tạo mục tiêu",
  DEFAULT: "mặc định 6 tháng vì mục tiêu chưa có thời hạn",
};

/** The API's reason codes, in its order. */
const reasonLabels: Record<string, string> = {
  COMPLETED_MONTHS_AVERAGE: "Dòng tiền khả dụng là trung bình dòng tiền ròng của các tháng hoàn chỉnh gần nhất (tối đa 3 tháng), không tính tháng hiện tại.",
  INSUFFICIENT_HISTORY: "Chưa đủ lịch sử giao dịch để đánh giá khả năng tích lũy.",
  TARGET_REACHED: "Đã đủ số tiền mục tiêu: không cần tiết kiệm thêm.",
  PAST_DEADLINE: "Đã quá hạn: toàn bộ số tiền còn thiếu cần có ngay.",
  INSTALLMENT_WITHOUT_INTEREST: "Trả góp chưa được mô hình hóa: không áp dụng lãi suất hay kỳ hạn.",
};

const toAmount = (text: string) => Number(String(text).trim().replace(",", "."));

const amountRule = (required: boolean, positive: boolean) => ({
  validator: (_: unknown, value?: string) => {
    const text = String(value ?? "").trim();
    if (!text) return required ? Promise.reject(new Error("Nhập số tiền")) : Promise.resolve();
    if (!AMOUNT_PATTERN.test(text)) {
      return Promise.reject(new Error("Nhập số không âm, tối đa 2 chữ số thập phân, không dùng dấu phân cách hàng nghìn"));
    }
    if (positive && toAmount(text) <= 0) return Promise.reject(new Error("Số tiền phải lớn hơn 0"));
    return Promise.resolve();
  },
});

const ErrorBlock = ({ text, onRetry, retrying }: { text: string; onRetry: () => void; retrying?: boolean }) => (
  <div className="flex flex-col items-center gap-3 py-8 text-center text-[12px] text-[var(--muted)]">
    <span>{text}</span>
    <Button onClick={onRetry} disabled={retrying}>
      {retrying ? "Đang thử lại..." : "Thử lại"}
    </Button>
  </div>
);

const goalDeadline = (goal: Goal) =>
  goal.date !== "-" ? `hạn ${goal.date}` : goal.months ? `${goal.months} tháng từ khi tạo` : "chưa đặt thời hạn";

/** The feasibility result: every number comes from the API, nothing is estimated here. */
function FeasibilityResult({ result, currency }: { result: GoalFeasibility; currency?: string }) {
  const level = levels[result.status];
  const insufficient = result.status === "INSUFFICIENT_DATA";
  const observed = result.observationMonths.map(formatMonthKey).join(", ");
  return (
    <div className="space-y-4">
      {result.pastDeadline && (
        <Alert type="warning" showIcon message="Đã quá hạn" description="Thời hạn đã qua: toàn bộ số tiền còn thiếu cần có ngay trong tháng này." />
      )}
      <div className="rounded-2xl bg-[color-mix(in_srgb,var(--accent)_9%,var(--surface))] p-5 text-center">
        <div className="text-[11px] text-[var(--muted)]">
          {result.pastDeadline ? "Cần có ngay" : `Cần tiết kiệm mỗi tháng trong ${result.months} tháng`}
        </div>
        <div className="mt-2 text-[28px] font-bold tabular-nums text-[var(--accent)]">{formatMoney(result.monthlyRequired, currency)}</div>
        {insufficient ? (
          <div className="mt-2 text-[11px] text-[var(--muted)]">Chưa có điểm khả thi</div>
        ) : (
          <div className="mt-2 text-[12px] font-semibold" style={{ color: level.color }}>
            Điểm khả thi {result.feasibilityScore}/100 · {level.label}
          </div>
        )}
      </div>
      {insufficient ? (
        <Alert
          type="info"
          showIcon
          message="Chưa đủ dữ liệu để đánh giá"
          description={
            <>
              Cần thêm {result.monthsRequired} tháng hoàn chỉnh có giao dịch bằng {currency ?? "VND"} (cần ít nhất 2 tháng).{" "}
              {observed ? `Đã có: ${observed}.` : "Chưa có tháng hoàn chỉnh nào."} Hệ thống không dùng số liệu giả định thay cho lịch sử của bạn.
            </>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-[var(--surface-2)] p-3">
            <div className="text-[10.5px] text-[var(--faint)]">Dòng tiền khả dụng trung bình</div>
            <div
              className="mt-1 text-[14px] font-bold tabular-nums"
              style={{ color: (result.availableMonthlyCashflow ?? 0) < 0 ? "var(--expense)" : undefined }}
            >
              {formatMoney(result.availableMonthlyCashflow ?? 0, currency)}/tháng
            </div>
          </div>
          <div className="rounded-xl bg-[var(--surface-2)] p-3">
            <div className="text-[10.5px] text-[var(--faint)]">Các tháng hoàn chỉnh được dùng</div>
            <div className="mt-1 text-[12px] font-semibold">{observed}</div>
          </div>
        </div>
      )}
      <ul className="space-y-1 text-[11px] text-[var(--muted)]">
        {result.reason.split(", ").map((code) => (
          <li key={code}>{reasonLabels[code] ?? code}</li>
        ))}
      </ul>
    </div>
  );
}

export function GoalsPage() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<CreateValues>();
  // The account time zone, so a deadline shows the date the API reads (not the browser's).
  const { query: overviewQuery } = useCustom<{ timeZone?: string | null }>({ url: "/dashboard/overview", method: "get" });
  const timeZone = overviewQuery.data?.data?.timeZone ?? undefined;
  const { query: listQuery } = useList<Record<string, unknown>>({ resource: "goals", pagination: { mode: "off" } });
  const goals = useMemo(() => listQuery.data?.data?.map((item) => mapGoal(item, timeZone)) ?? [], [listQuery.data, timeZone]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = goals.find((goal) => goal.id === selectedId) ?? goals[0];
  const [whatIf, setWhatIf] = useState<WhatIf | null>(null);
  const [sliderDraft, setSliderDraft] = useState<WhatIf | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErrors, setCreateErrors] = useState<string[]>([]);

  // Without a what-if horizon the API applies the goal's own horizon (target date, planned months, or the default).
  const whatIfMonths = whatIf && whatIf.goalId === selected?.id ? whatIf.months : null;
  const draftMonths = sliderDraft && sliderDraft.goalId === selected?.id ? sliderDraft.months : null;
  const { query: simulationQuery } = useCustom<GoalFeasibility>({
    url: `/goals/${selected?.id ?? "none"}/simulation`,
    method: "get",
    config: { query: { months: whatIfMonths ?? undefined } },
    queryOptions: { enabled: Boolean(selected) },
  });
  const raw = simulationQuery.data?.data;
  // refine keeps the previous query's data as a placeholder: never show another goal's result.
  const result = raw && selected && raw.goalId === selected.id ? raw : undefined;
  const updating = Boolean(result) && simulationQuery.isPlaceholderData;

  const { mutateAsync: send } = useCustomMutation<{ id: string }, HttpError, Record<string, unknown>>();

  const selectGoal = (goal: Goal) => {
    setSelectedId(goal.id);
    setWhatIf(null);
    setSliderDraft(null);
  };

  const closeModal = () => {
    if (creating) return;
    setOpen(false);
    setCreateErrors([]);
    form.resetFields();
  };

  const submit = async (values: CreateValues) => {
    if (creating) return;
    setCreating(true);
    setCreateErrors([]);
    try {
      const response = await send({
        url: "/goals",
        method: "post",
        values: {
          name: values.name.trim(),
          type: values.type?.trim() || undefined,
          targetAmount: toAmount(values.targetAmount),
          savedAmount: values.savedAmount?.trim() ? toAmount(values.savedAmount) : undefined,
          // Only what the user entered: an empty horizon stays empty, so the API's visible default applies.
          targetDate: values.targetDate || undefined,
          months: values.months?.trim() ? Number(values.months) : undefined,
        },
      });
      message.success("Đã tạo mục tiêu");
      setOpen(false);
      form.resetFields();
      setSelectedId(response.data.id);
      setWhatIf(null);
      void listQuery.refetch();
    } catch (error) {
      const { fieldErrors, otherErrors } = apiFieldErrors(error, CREATE_FIELDS);
      form.setFields(Object.entries(fieldErrors).map(([name, errors]) => ({ name: name as keyof CreateValues, errors })));
      setCreateErrors(otherErrors);
    } finally {
      setCreating(false);
    }
  };

  const createButton = (
    <Button variant="primary" icon={<Icon name="plus" width={15} />} onClick={() => setOpen(true)}>
      Tạo mục tiêu
    </Button>
  );

  const createModal = (
    <Modal title="Tạo mục tiêu tài chính" open={open} onCancel={closeModal} footer={null} maskClosable={!creating}>
      <Form form={form} layout="vertical" onFinish={submit} disabled={creating}>
        {createErrors.length > 0 && (
          <Alert className="mb-4" type="error" showIcon message={createErrors.map((text) => <div key={text}>{text}</div>)} />
        )}
        <Form.Item
          label="Tên mục tiêu"
          name="name"
          rules={[
            { required: true, whitespace: true, message: "Nhập tên mục tiêu" },
            { max: 120, message: "Tối đa 120 ký tự" },
          ]}
        >
          <Input placeholder="VD: Mua xe máy" />
        </Form.Item>
        <Form.Item label="Loại" name="type" rules={[{ max: 80, message: "Tối đa 80 ký tự" }]}>
          <Input placeholder="Mua sắm dự định" />
        </Form.Item>
        <Form.Item label="Số tiền mục tiêu" name="targetAmount" rules={[amountRule(true, true)]}>
          <Input inputMode="decimal" suffix="VND" />
        </Form.Item>
        <Form.Item label="Đã có" name="savedAmount" rules={[amountRule(false, false)]}>
          <Input inputMode="decimal" suffix="VND" />
        </Form.Item>
        <Form.Item label="Ngày hoàn thành (không bắt buộc)" name="targetDate">
          <Input type="date" />
        </Form.Item>
        <Form.Item
          label="Hoặc số tháng (không bắt buộc)"
          name="months"
          extra="Khi có cả hai, ngày hoàn thành được dùng. Để trống cả hai thì dùng mặc định 6 tháng."
          rules={[{ pattern: /^[1-9]\d{0,3}$/, message: "Nhập số nguyên từ 1" }]}
        >
          <Input inputMode="numeric" />
        </Form.Item>
        <Button type="submit" variant="primary" className="w-full" disabled={creating}>
          {creating ? "Đang tạo..." : "Tạo mục tiêu"}
        </Button>
      </Form>
    </Modal>
  );

  // A failed refresh of an already-loaded list (for example after creating the first goal) is shown in every state.
  const listRefreshFailed = listQuery.isError && !listQuery.isFetching && (
    <Alert
      className="mb-3"
      type="warning"
      showIcon
      message={`Không thể làm mới danh sách mục tiêu. ${describeApiError(listQuery.error)}`}
      action={<Button onClick={() => void listQuery.refetch()}>Thử lại</Button>}
    />
  );

  const goalList = listQuery.data?.data;
  if (!goalList) {
    return (
      <div className="space-y-5">
        <SectionHeading title="Mục tiêu của bạn" action={createButton} />
        <Card>
          {listQuery.isError ? (
            <ErrorBlock
              text={`Không thể tải mục tiêu. ${describeApiError(listQuery.error)}`}
              onRetry={() => void listQuery.refetch()}
              retrying={listQuery.isFetching}
            />
          ) : (
            <Skeleton active paragraph={{ rows: 4 }} />
          )}
        </Card>
        {createModal}
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="space-y-5">
        <SectionHeading title="Mục tiêu của bạn" action={createButton} />
        {listRefreshFailed}
        <Card>
          <div className="py-8 text-center text-[12px] text-[var(--muted)]">
            Chưa có mục tiêu tài chính. Tạo mục tiêu để xem mức tiết kiệm cần thiết từ lịch sử giao dịch của bạn.
          </div>
        </Card>
        {createModal}
      </div>
    );
  }

  const currency = selected.currency;
  const remaining = result?.remainingAmount ?? selected.remaining ?? 0;
  const sliderValue = draftMonths ?? whatIfMonths ?? Math.min(WHAT_IF_MAX, Math.max(1, result?.months ?? 1));

  return (
    <div className="grid gap-5 xl:grid-cols-[.9fr_1.4fr]">
      <div>
        <SectionHeading title="Mục tiêu của bạn" action={createButton} />
        {listRefreshFailed}
        <div className="space-y-3">
          {goals.map((goal) => {
            const percent = goal.target > 0 ? Math.min(100, Math.round((goal.saved / goal.target) * 100)) : 0;
            return (
              <button key={goal.id} onClick={() => selectGoal(goal)} className="w-full text-left">
                <Card className={selected.id === goal.id ? "ring-2 ring-[var(--accent)]" : ""}>
                  <div className="flex justify-between gap-4">
                    <div>
                      <div className="text-[12.5px] font-semibold">{goal.name}</div>
                      <div className="mt-1 text-[10.5px] text-[var(--faint)]">
                        {goal.type} · {goalDeadline(goal)}
                      </div>
                    </div>
                    <span className="text-[18px] font-bold text-[var(--accent)]">{percent}%</span>
                  </div>
                  <div className="mt-4">
                    <ProgressBar value={percent} />
                  </div>
                  <div className="mt-2 flex justify-between text-[10.5px] text-[var(--muted)]">
                    <span>{formatMoneyShort(goal.saved, goal.currency)} đã có</span>
                    <span>{formatMoneyShort(goal.target, goal.currency)}</span>
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      </div>
      <Card>
        <SectionHeading title={`Khả năng hoàn thành · ${selected.name}`} description="Tính từ lịch sử giao dịch thực tế của bạn, không dùng số liệu giả định" />
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            ["Mục tiêu", formatMoney(selected.target, currency)],
            ["Đã có", formatMoney(selected.saved, currency)],
            ["Còn thiếu", formatMoney(remaining, currency)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-[var(--surface-2)] p-3">
              <div className="text-[10.5px] text-[var(--faint)]">{label}</div>
              <div className="mt-1 text-[14px] font-bold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span>
              {result
                ? `Thời hạn còn lại: ${result.months} tháng (${horizonLabels[result.horizonSource]})`
                : "Thời hạn còn lại"}
            </span>
            {whatIfMonths !== null && (
              <Button
                onClick={() => {
                  setWhatIf(null);
                  setSliderDraft(null);
                }}
              >
                Dùng thời hạn của mục tiêu
              </Button>
            )}
          </div>
          <div className="mt-3 flex justify-between text-[11px] text-[var(--muted)]">
            <span>Thử thời hạn khác</span>
            <b>{sliderValue} tháng</b>
          </div>
          <Slider
            min={1}
            max={WHAT_IF_MAX}
            value={sliderValue}
            onChange={(months) => setSliderDraft({ goalId: selected.id, months })}
            onChangeComplete={(months) => setWhatIf({ goalId: selected.id, months })}
            ariaLabelForHandle="Thử thời hạn khác (tháng)"
            ariaValueTextFormatterForHandle={(months) => `${months} tháng`}
          />
        </div>
        <div className={`mt-4 ${updating ? "opacity-60" : ""}`}>
          {updating && <div className="mb-2 text-[11px] text-[var(--muted)]">Đang cập nhật...</div>}
          {result ? (
            <>
              {simulationQuery.isError && !simulationQuery.isFetching && (
                <Alert
                  className="mb-3"
                  type="warning"
                  showIcon
                  message={`Không thể làm mới kết quả. ${describeApiError(simulationQuery.error)}`}
                  action={<Button onClick={() => void simulationQuery.refetch()}>Thử lại</Button>}
                />
              )}
              <FeasibilityResult result={result} currency={currency} />
            </>
          ) : simulationQuery.isError ? (
            <ErrorBlock
              text={`Không thể tính khả năng hoàn thành. ${describeApiError(simulationQuery.error)}`}
              onRetry={() => void simulationQuery.refetch()}
              retrying={simulationQuery.isFetching}
            />
          ) : (
            <Skeleton active paragraph={{ rows: 4 }} />
          )}
        </div>
      </Card>
      {createModal}
    </div>
  );
}
