import { describe, it, expect, beforeEach, vi } from "vitest";
import { pruneHeldIdeas, saveHeldIdea, loadHeldIdeas } from "./storage";
import type { Idea } from "./types";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

const held = (id: number, at: string): Idea => ({ id, product: "alpha", text: `Idea ${id}`, status: "under-review", votes: 0, public: false, created_at: at });

describe("pruneHeldIdeas", () => {
  const now = Date.parse("2026-11-13T10:00:00Z");
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));

  it("drops held ideas that became public, keeps the others", () => {
    saveHeldIdea(held(1, "2026-11-13T09:00:00Z"));
    saveHeldIdea(held(2, "2026-11-13T09:00:00Z"));
    expect(pruneHeldIdeas(new Set(["1"]), now).map((i) => i.id)).toEqual([2]);
    expect(loadHeldIdeas().map((i) => i.id)).toEqual([2]);
  });

  it("drops held ideas older than a week (owner hid or declined them)", () => {
    saveHeldIdea(held(1, "2026-11-01T09:00:00Z"));
    expect(pruneHeldIdeas(new Set(), now)).toEqual([]);
  });

  it("survives a throwing or corrupt storage", () => {
    localStorage.setItem("office-held-ideas", "{not json");
    expect(pruneHeldIdeas(new Set(), now)).toEqual([]);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(pruneHeldIdeas(new Set(), now)).toEqual([]);
  });
});
