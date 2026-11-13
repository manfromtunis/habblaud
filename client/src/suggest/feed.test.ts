import { describe, it, expect } from "vitest";
import { selectLatestIdeas, formatRelativeTime } from "./feed";
import type { Idea } from "./types";

describe("latest ideas feed logic", () => {
  it("selects latest ideas sorted by created_at descending", () => {
    const ideas: Idea[] = [
      { id: 1, product: "alpha", text: "Idea 1", status: "under-review", votes: 0, created_at: "2026-11-12T10:00:00Z" },
      { id: 2, product: "beta", text: "Idea 2", status: "under-review", votes: 0, created_at: "2026-11-12T12:00:00Z" },
      { id: 3, product: "alpha", text: "Idea 3", status: "under-review", votes: 0, created_at: "2026-11-12T11:00:00Z" },
      { id: 4, product: "alpha", text: "Idea 4", status: "under-review", votes: 0, created_at: "2026-11-12T09:00:00Z" },
    ];

    const latest3 = selectLatestIdeas(ideas, 3);
    expect(latest3.map((i) => i.id)).toEqual([2, 3, 1]);

    const latest2 = selectLatestIdeas(ideas, 2);
    expect(latest2.map((i) => i.id)).toEqual([2, 3]);
  });

  it("falls back to numeric id descending if created_at is missing", () => {
    const ideas: Idea[] = [
      { id: 10, product: "alpha", text: "Idea 10", status: "under-review", votes: 0 },
      { id: 30, product: "beta", text: "Idea 30", status: "under-review", votes: 0 },
      { id: 20, product: "alpha", text: "Idea 20", status: "under-review", votes: 0 },
    ];

    expect(selectLatestIdeas(ideas, 2).map((i) => i.id)).toEqual([30, 20]);
  });

  it("formats relative time correctly", () => {
    const now = 1700000000000;
    expect(formatRelativeTime(now - 10000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60 * 1000, now)).toBe("5m ago");
    expect(formatRelativeTime(now - 2 * 3600 * 1000, now)).toBe("2h ago");
    expect(formatRelativeTime(now - 3 * 86400 * 1000, now)).toBe("3d ago");
    expect(formatRelativeTime(undefined, now)).toBe("recently");
    expect(formatRelativeTime("invalid-date", now)).toBe("recently");
  });
});
