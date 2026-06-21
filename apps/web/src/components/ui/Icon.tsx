import type { SVGProps } from "react";

const paths: Record<string, string[]> = {
  dashboard: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  transactions: ["M4 7h16", "M4 12h16", "M4 17h10"],
  accounts: ["M4 7h16a2 2 0 0 1 2 2v9H4a2 2 0 0 1-2-2V7z", "M2 11h20", "M17 15h1"],
  budgets: ["M12 4a8 8 0 1 0 8 8h-8z", "M12 4v8l6 4"],
  goals: ["M12 4a8 8 0 1 0 8 8", "M12 8a4 4 0 1 0 4 4", "M12 12l8-8", "M16 4h4v4"],
  alerts: ["M12 4 3.5 19h17z", "M12 10v4", "M12 17h.01"],
  email: ["M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "m3 8 5 4 5-4"],
  ops: ["M3 12h4l2.5-6 4 13 2.5-7H21"],
  settings: ["M4 8h9", "M11 16h9"],
  collapse: ["M4 4h16v16H4z", "M10 4v16"],
  search: ["M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z", "m16 16 5 5"],
  sun: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 2v2", "M12 20v2", "M4 12H2", "M22 12h-2", "m5 5-1.5-1.5", "m17.5 17.5-1.5-1.5", "m19 5 1.5-1.5", "m3.5 20.5 1.5-1.5"],
  moon: ["M20 15a8 8 0 1 1-11-11 7 7 0 0 0 11 11z"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  plus: ["M12 5v14", "M5 12h14"],
  sync: ["M20 7h-5V2", "M4 17h5v5", "M5 11a7 7 0 0 1 12-5l3 1", "M19 13a7 7 0 0 1-12 5l-3-1"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  logout: ["M10 5H5v14h5", "M14 8l4 4-4 4", "M18 12H9"],
};

export function Icon({ name, ...props }: { name: keyof typeof paths } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {paths[name].map((path, index) => (
        <path key={`${name}-${index}`} d={path} />
      ))}
    </svg>
  );
}
