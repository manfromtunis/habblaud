import type { Idea } from "./types";

export interface PostIdeaResult {
  id: number | string;
  public: boolean;
  product: string;
  text: string;
  status: string;
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
  email?: string
): Promise<PostIdeaResult> {
  const body = {
    product,
    text,
    email: email && email.trim() ? email.trim() : undefined,
    website: "",
  };
  const res = await fetch("/suggest/idea", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res, "Request failed");
  const data = (await res.json()) as { id: number | string; public?: boolean; product?: string; text?: string; status?: string };
  return {
    id: data.id,
    public: data.public !== false,
    product: data.product ?? product,
    text: data.text ?? text,
    status: data.status ?? "under-review",
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
