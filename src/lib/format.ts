export function formatMMK(value: number | bigint | string | null | undefined): string {
  const n = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  if (!Number.isFinite(n)) return "MMK 0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " MMK";
}

export function formatMMKCompact(value: number | bigint | string | null | undefined): string {
  const n = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  if (!Number.isFinite(n)) return "MMK 0";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B MMK";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M MMK";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K MMK";
  return n.toFixed(0) + " MMK";
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
