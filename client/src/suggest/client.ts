import type { Idea } from "./types";

export interface PostIdeaResult {
  /** null when the service took the request as a bot's (honeypot filled): nothing was stored. */
  id: number | string | null;
  public: boolean;
  product: string;
  text: string;
  status: string;
  /** The service's "AI first look" (fixed phrases built server-side), null when not run or failed. */
  look: FirstLook | null;
}

export interface FirstLook {
  fit: string;
  effort: string;
}

export function parseLook(v: unknown): FirstLook | null {
  if (!v || typeof v !== "object") return null;
  const { fit, effort } = v as Record<string, unknown>;
  if (typeof fit !== "string" || typeof effort !== "string" || !fit.trim() || !effort.trim()) return null;
  return { fit: fit.slice(0, 200), effort: effort.slice(0, 200) };
}

async function httpError(res: Response, fallback: string): Promise<Error & { status?: number }> {
  let msg = `${fallback} (${res.status})`;
  try {
    const errJson = (await res.json()) as { error?: string };
    if (errJson.error) msg = errJson.error;
  } catch {
    // not JSON: keep the fallback
  }
  return Object.assign(new Error(msg), { status: res.status });
}

export async function fetchIdeas(): Promise<Idea[]> {
  const res = await fetch("/suggest/ideas.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ideas (${res.status})`);
  }
  const data = (await res.json()) as { ideas?: Idea[] };
  return Array.isArray(data.ideas) ? data.ideas : [];
}

export async function postIdea(
  product: string,
  text: string,
  email?: string,
  website = ""
): Promise<PostIdeaResult> {
  const body = {
    product,
    text,
    email: email && email.trim() ? email.trim() : undefined,
    website,
  };
  // the service waits up to 3 s for the AI first look; never leave "Sending..." stuck longer than this
  const res = await fetch("/suggest/idea", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw await httpError(res, "Request failed");
  const data = (await res.json()) as { id: number | string | null; public?: boolean; product?: string; text?: string; status?: string; look?: unknown };
  return {
    id: data.id ?? null,
    public: data.public !== false,
    product: data.product ?? product,
    text: data.text ?? text,
    status: data.status ?? "under-review",
    look: parseLook(data.look),
  };
}

export interface PostVoteResult {
  idea_id: number | string;
  votes: number;
  on: boolean;
}

export async function postVote(
  ideaId: number | string,
  token: string,
  on: boolean
): Promise<PostVoteResult> {
  const idNum = typeof ideaId === "number" ? ideaId : parseInt(String(ideaId), 10);
  const res = await fetch("/suggest/vote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea_id: idNum, token, on }),
  });
  if (!res.ok) throw await httpError(res, "Vote failed");
  const data = (await res.json()) as { idea_id: number; votes: number; on: boolean };
  return {
    idea_id: data.idea_id,
    votes: data.votes,
    on: data.on,
  };
}
