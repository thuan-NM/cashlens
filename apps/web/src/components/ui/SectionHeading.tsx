import type { ReactNode } from "react";

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2.5 text-[13.5px] font-bold">
          <span className="h-4 w-1 rounded-full bg-[var(--accent)]" />
          {title}
        </div>
        {description && <p className="mt-1 pl-3.5 text-[11.5px] text-[var(--faint)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}
