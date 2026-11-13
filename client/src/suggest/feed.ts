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

/** How long an own idea from a POST reply is kept while ideas.json (cached up to 30 s) does not list it yet. */
export const OWN_IDEA_GRACE_MS = 120_000;

/**
 * The polled list plus own public ideas sent in the last OWN_IDEA_GRACE_MS that it does not list yet,
 * so a stale or cached poll reply never hides the idea the visitor just sent.
 */
export function mergePolledIdeas(remote: Idea[], recentOwn: Idea[], nowMs: number = Date.now()): Idea[] {
  const ids = new Set(remote.map((i) => String(i.id)));
  const pending = recentOwn.filter((i) => {
    const sent = i.created_at ? Date.parse(i.created_at) : NaN;
    return !ids.has(String(i.id)) && Number.isFinite(sent) && nowMs - sent < OWN_IDEA_GRACE_MS;
  });
  return [...pending, ...remote];
}
