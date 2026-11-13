import type { Idea } from "./types";

const OWN_IDEAS_KEY = "office-own-ideas";
const HELD_IDEAS_KEY = "office-held-ideas";
const VOTED_IDEAS_KEY = "office-voted-ideas";

// localStorage can be missing or throw (private mode, blocked site data): every access is guarded.
function readJsonArray(key: string): unknown[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadOwnIdeaIds(): Set<string> {
  return new Set(readJsonArray(OWN_IDEAS_KEY).map(String));
}

export function saveOwnIdeaId(id: string | number): void {
  const set = loadOwnIdeaIds();
  set.add(String(id));
  writeJson(OWN_IDEAS_KEY, [...set]);
}

export function loadHeldIdeas(): Idea[] {
  return readJsonArray(HELD_IDEAS_KEY) as Idea[];
}

export function saveHeldIdea(idea: Idea): void {
  const list = loadHeldIdeas();
  if (list.some((i) => String(i.id) === String(idea.id))) return;
  list.push(idea);
  writeJson(HELD_IDEAS_KEY, list);
}

/** Drops held ideas that are now public (ids in publicIds); returns the ones still held. */
export function pruneHeldIdeas(publicIds: Set<string>): Idea[] {
  const list = loadHeldIdeas();
  const kept = list.filter((i) => !publicIds.has(String(i.id)));
  if (kept.length !== list.length) writeJson(HELD_IDEAS_KEY, kept);
  return kept;
}

export function loadVotedIdeaIds(): Set<string> {
  return new Set(readJsonArray(VOTED_IDEAS_KEY).map(String));
}

export function setVotedIdeaId(id: string | number, voted: boolean): void {
  const set = loadVotedIdeaIds();
  if (voted) set.add(String(id));
  else set.delete(String(id));
  writeJson(VOTED_IDEAS_KEY, [...set]);
}
