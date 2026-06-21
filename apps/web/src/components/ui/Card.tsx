import { cn } from "@/utils/cn";
import type { ReactNode, HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hover?: boolean;
  padding?: string;
  accent?: boolean;
}

export function Card({ children, hover, accent, className, padding = "p-5", style, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "glass-card rounded-[18px] transition-all duration-200",
        padding,
        hover && "cursor-pointer hover:-translate-y-[3px] hover:shadow-[var(--shadowh)]",
        className
      )}
      style={{
        ...(accent
          ? {
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--accent) 13%, transparent), color-mix(in srgb, var(--accent) 2%, transparent)), var(--cardbg)",
            }
          : {}),
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
