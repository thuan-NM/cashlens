import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/cn";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  icon?: ReactNode;
}

export function Button({ children, variant = "secondary", icon, className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-[12px] px-5 text-[12.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "border border-transparent bg-[var(--accent)] text-white shadow-[0_8px_20px_-8px_rgba(217,119,87,.7)] hover:brightness-105",
        variant === "secondary" &&
          "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)]",
        variant === "ghost" && "border border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--surface-2)]",
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
