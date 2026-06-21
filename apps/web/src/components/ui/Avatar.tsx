interface AvatarProps {
  initials: string;
  size?: number;
}

export function Avatar({ initials, size = 34 }: AvatarProps) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold shrink-0"
      style={{
        width: size,
        height: size,
        background: "var(--accent)",
        color: "#fff",
        fontSize: size * 0.34,
      }}
    >
      {initials}
    </div>
  );
}
