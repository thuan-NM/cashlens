import { cn } from "@/utils/cn";

export function Logo({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] shadow-[0_5px_14px_rgba(217,119,87,.35)]",
          inverse ? "bg-white" : "bg-[var(--accent)]"
        )}
      >
        <span
          className={cn(
            "h-[11px] w-[11px] rounded-full border-[2.2px]",
            inverse ? "border-[var(--accent)]" : "border-white"
          )}
        />
      </span>
      {!compact && <span className={cn("text-[15.5px] font-bold tracking-tight", inverse && "text-white")}>CashLens</span>}
    </div>
  );
}
