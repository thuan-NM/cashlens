import { useState } from "react";
import { Alert as Notice, App as AntdApp, Form, Input, Modal, Select, Skeleton } from "antd";
import { useCreate, useCustom, useList } from "@refinedev/core";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { apiFieldErrors, describeApiError, mapBudget, mapCategory } from "@/api/mappers";
import type { ApiBudget, ApiBudgetSummary, Budget } from "@/types/budget";
import { formatMoney, formatMoneyShort } from "@/utils/format";

const CREATE_FIELDS = ["name", "categoryId", "amount", "period", "startsAt", "thresholdPercent"] as const;

type CreateValues = {
  name: string;
  categoryId?: string;
  amount: string;
  period: string;
  startsAt: string;
  thresholdPercent: string;
};

/** The first day of the current calendar month, as the date input expects. */
const firstOfThisMonth = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
};

const periodLabels: Record<string, string> = {
  MONTHLY: "Hằng tháng",
  WEEKLY: "Hằng tuần",
  YEARLY: "Hằng năm",
  CUSTOM: "Tùy chỉnh",
};

/** The threshold line under a budget (BUDGET-001, BUDGET-004, BUDGET-005). */
const thresholdLine = (budget: Budget) => {
  if (!budget.alertsSupported) return "Chỉ ngân sách tháng có cảnh báo (alerts available for monthly budgets only)";
  if (!budget.warningThresholdActive) return `Ngưỡng cũ ${budget.threshold}%: chỉ cảnh báo khi đạt 100%`;
  return `Cảnh báo ở ${budget.threshold}% · nghiêm trọng ở 100%`;
};

function BudgetCard({ budget, category }: { budget: Budget; category: { name: string; color: string } }) {
  const percent = budget.percentUsed;
  const color = budget.isOverLimit || percent >= 100 ? "var(--expense)" : budget.isNearThreshold ? "var(--warn)" : category.color;
  return (
    <Card hover>
      <div data-testid={`budget-${budget.id}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="h-9 w-9 shrink-0 rounded-[10px]" style={{ background: `${category.color}22` }} />
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold">{budget.name || category.name}</div>
              <div className="truncate text-[10.5px] text-[var(--faint)]">
                {category.name} · {periodLabels[budget.period] ?? budget.period}
              </div>
            </div>
          </div>
          <span className="text-[17px] font-bold" style={{ color }}>
            {percent}%
          </span>
        </div>
        <div className="mt-5">
          <ProgressBar value={percent} color={color} />
        </div>
        <div className="mt-2 flex justify-between text-[11px]">
          <span className="text-[var(--muted)]">
            Đã chi <b className="text-[var(--text)]">{formatMoneyShort(budget.spent)}</b>
          </span>
          <span>Còn {formatMoneyShort(Math.max(0, budget.limit - budget.spent))}</span>
        </div>
        <div className="mt-2 text-[10.5px] text-[var(--faint)]" data-testid="budget-threshold">
          {thresholdLine(budget)}
        </div>
        {budget.usageBasis === "CALENDAR_MONTH_APPROXIMATION" && (
          <div className="mt-1 text-[10px] text-[var(--faint)]">Mức đã chi ước tính theo tháng dương lịch.</div>
        )}
      </div>
    </Card>
  );
}

export function BudgetsPage() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<CreateValues>();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErrors, setCreateErrors] = useState<string[]>([]);
  const { result, query } = useList<ApiBudget>({ resource: "budgets", pagination: { mode: "off" } });
  const { result: summary } = useCustom<ApiBudgetSummary>({ url: "/budgets/summary", method: "get" });
  const { result: categoriesResult } = useList<Record<string, unknown>>({ resource: "transaction-categories", pagination: { mode: "off" } });
  const { mutateAsync: createBudget } = useCreate();
  const categories = categoriesResult?.data?.map(mapCategory) ?? [];
  const budgets = query.data ? (result?.data ?? []).map(mapBudget) : null;
  const totalLimit = Number(summary?.data?.totalLimit ?? 0);
  const totalSpent = Number(summary?.data?.totalSpent ?? 0);

  const submit = async (values: CreateValues) => {
    setCreating(true);
    setCreateErrors([]);
    try {
      await createBudget({
        resource: "budgets",
        values: {
          name: values.name.trim(),
          categoryId: values.categoryId || undefined,
          amount: Number(String(values.amount).trim()),
          period: values.period,
          startsAt: values.startsAt,
          thresholdPercent: Number(values.thresholdPercent),
        },
        successNotification: false,
        errorNotification: false,
      });
      message.success("Đã tạo ngân sách");
      setOpen(false);
      form.resetFields();
      void query.refetch();
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
      Tạo ngân sách
    </Button>
  );

  const content = (() => {
    if (!budgets) {
      return (
        <Card>
          {query.isError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-[12px] text-[var(--muted)]">
              <span>Không thể tải ngân sách. {describeApiError(query.error)}</span>
              <Button onClick={() => void query.refetch()} disabled={query.isFetching}>
                {query.isFetching ? "Đang thử lại..." : "Thử lại"}
              </Button>
            </div>
          ) : (
            <Skeleton active paragraph={{ rows: 4 }} />
          )}
        </Card>
      );
    }
    if (!budgets.length) {
      return (
        <Card>
          <div className="py-8 text-center text-[12px] text-[var(--muted)]">Chưa có ngân sách. Tạo ngân sách tháng để nhận cảnh báo khi chi tiêu gần hạn mức.</div>
        </Card>
      );
    }
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {budgets.map((budget) => {
          const category = categories.find((item) => item.id === budget.cat) ?? {
            name: budget.cat ? "Nhóm đã ẩn" : "Tất cả nhóm chi",
            color: "#8a8378",
          };
          return <BudgetCard key={budget.id} budget={budget} category={category} />;
        })}
      </div>
    );
  })();

  return (
    <div className="space-y-5">
      <Card accent>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11.5px] text-[var(--muted)]">Tổng ngân sách tháng</div>
            <div className="mt-2 text-[30px] font-bold tabular-nums">{formatMoney(totalLimit)}</div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">
              Đã dùng {formatMoney(totalSpent)} · còn {formatMoney(totalLimit - totalSpent)}
            </div>
          </div>
          <div className="min-w-[220px] flex-1 sm:max-w-[420px]">
            <div className="mb-2 flex justify-between text-[11px]">
              <span>Tiến độ chung</span>
              <b>{totalLimit ? Math.round((totalSpent / totalLimit) * 100) : 0}%</b>
            </div>
            <ProgressBar value={totalLimit ? (totalSpent / totalLimit) * 100 : 0} />
          </div>
        </div>
      </Card>
      <SectionHeading title="Ngân sách theo nhóm" action={createButton} />
      {query.isError && budgets && (
        <Notice
          type="warning"
          showIcon
          message={`Không thể làm mới danh sách ngân sách. ${describeApiError(query.error)}`}
          action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
        />
      )}
      {content}
      <Modal title="Tạo ngân sách mới" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
        {createErrors.length > 0 && <Notice className="mb-4" type="error" showIcon message={createErrors.map((text) => <div key={text}>{text}</div>)} />}
        <Form<CreateValues>
          form={form}
          layout="vertical"
          onFinish={(values) => void submit(values)}
          initialValues={{ period: "MONTHLY", thresholdPercent: "80", startsAt: firstOfThisMonth() }}
        >
          <Form.Item label="Tên ngân sách" name="name" rules={[{ required: true, whitespace: true, message: "Nhập tên ngân sách" }]}>
            <Input placeholder="Ăn uống tháng này" maxLength={120} />
          </Form.Item>
          <Form.Item label="Nhóm chi tiêu" name="categoryId" extra="Để trống để tính mọi khoản chi.">
            <Select allowClear options={categories.filter((item) => item.type === "expense").map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item
            label="Hạn mức"
            name="amount"
            rules={[
              { required: true, message: "Nhập hạn mức" },
              { pattern: /^\d+(?:\.\d{1,2})?$/, message: "Nhập số không âm, không dùng dấu phân cách hàng nghìn" },
            ]}
          >
            <Input suffix="VND" placeholder="3000000" inputMode="decimal" />
          </Form.Item>
          <Form.Item label="Chu kỳ" name="period" extra="Cảnh báo chỉ áp dụng cho ngân sách hằng tháng.">
            <Select options={Object.entries(periodLabels).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="Bắt đầu từ" name="startsAt" rules={[{ required: true, message: "Chọn ngày bắt đầu" }]} extra="Chi tiêu trước ngày này không được tính.">
            <Input type="date" />
          </Form.Item>
          <Form.Item
            label="Ngưỡng cảnh báo"
            name="thresholdPercent"
            extra="Từ 1 đến 99%. Cảnh báo nghiêm trọng luôn ở 100%."
            rules={[
              { required: true, message: "Nhập ngưỡng cảnh báo" },
              {
                validator: (_, value?: string) => {
                  const number = Number(value);
                  return /^\d+$/.test(String(value ?? "")) && number >= 1 && number <= 99
                    ? Promise.resolve()
                    : Promise.reject(new Error("Ngưỡng là số nguyên từ 1 đến 99"));
                },
              },
            ]}
          >
            <Input suffix="%" inputMode="numeric" />
          </Form.Item>
          <Button variant="primary" className="w-full" disabled={creating}>
            {creating ? "Đang tạo..." : "Tạo ngân sách"}
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
