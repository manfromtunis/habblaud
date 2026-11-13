import type { Idea } from "./types";

const OWN_IDEAS_KEY = "office-own-ideas";
const HELD_IDEAS_KEY = "office-held-ideas";
const VOTED_IDEAS_KEY = "office-voted-ideas";

export function loadOwnIdeaIds(): Set<string> {
  try {
    if (typeof localStorage === "undefined") return new Set();
    const raw = localStorage.getItem(OWN_IDEAS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.map(String));
  } catch {
    // fallback
  }
  return new Set();
}

export function saveOwnIdeaId(id: string | number): void {
  try {
    if (typeof localStorage === "undefined") return;
    const set = loadOwnIdeaIds();
    set.add(String(id));
    localStorage.setItem(OWN_IDEAS_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

export function loadHeldIdeas(): Idea[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(HELD_IDEAS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Idea[];
  } catch {
    // ignore
  }
  return [];
}

export function saveHeldIdea(idea: Idea): void {
  try {
    if (typeof localStorage === "undefined") return;
    const list = loadHeldIdeas();
    const idStr = String(idea.id);
    if (!list.some((i) => String(i.id) === idStr)) {
      list.push(idea);
      localStorage.setItem(HELD_IDEAS_KEY, JSON.stringify(list));
    }
  } catch {
    // ignore
  }
}

export function loadVotedIdeaIds(): Set<string> {
  try {
    if (typeof localStorage === "undefined") return new Set();
    const raw = localStorage.getItem(VOTED_IDEAS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.map(String));
  } catch {
    // ignore
  }
  return new Set();
}

export function setVotedIdeaId(id: string | number, voted: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    const set = loadVotedIdeaIds();
    const idStr = String(id);
    if (voted) set.add(idStr);
    else set.delete(idStr);
    localStorage.setItem(VOTED_IDEAS_KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
}

/** Drops held ideas that are now public (ids in publicIds); returns the ones still held. */
export function pruneHeldIdeas(publicIds: Set<string>): Idea[] {
  const list = loadHeldIdeas();
  const kept = list.filter((i) => !publicIds.has(String(i.id)));
  if (kept.length !== list.length) {
    try {
      localStorage.setItem(HELD_IDEAS_KEY, JSON.stringify(kept));
    } catch {
      // ignore
    }
  }
  return kept;
}
