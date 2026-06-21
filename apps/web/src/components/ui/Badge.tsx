import { cn } from "@/utils/cn";
import type { ReactNode } from "react";

interface BadgeProps {
  label?: string;
  children?: ReactNode;
  color?: string;
  className?: string;
}

export function Badge({ label, children, color, className }: BadgeProps) {
  return (
    <span
      className={cn("inline-flex items-center px-2 py-0.5 rounded-[7px] text-[11px] font-semibold", className)}
      style={color ? { background: color + "22", color } : undefined}
    >
      {children ?? label}
    </span>
  );
}
