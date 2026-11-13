import type { Idea } from "./types";

export function selectLatestIdeas(ideas: Idea[], limit: number = 3): Idea[] {
  const sorted = [...ideas].sort((a, b) => {
    const timeA = a.created_at ? Date.parse(a.created_at) : NaN;
    const timeB = b.created_at ? Date.parse(b.created_at) : NaN;

    if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
      return timeB - timeA;
    }
    const numA = typeof a.id === "number" ? a.id : Number(a.id);
    const numB = typeof b.id === "number" ? b.id : Number(b.id);
    if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) {
      return numB - numA;
    }
    return 0;
  });

  return sorted.slice(0, limit);
}

export function formatRelativeTime(
  isoOrTimestamp: string | number | undefined,
  nowMs: number = Date.now()
): string {
  if (!isoOrTimestamp) return "recently";
  const time = typeof isoOrTimestamp === "number" ? isoOrTimestamp : Date.parse(isoOrTimestamp);
  if (!Number.isFinite(time)) return "recently";

  const diffSec = Math.max(0, Math.floor((nowMs - time) / 1000));
  if (diffSec < 45) return "just now";
  if (diffSec < 3600) return `${Math.max(1, Math.floor(diffSec / 60))}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
