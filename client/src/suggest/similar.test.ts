import { describe, it, expect } from "vitest";
import { countWords, tokenizeText, sameWord, findSimilarIdeas } from "./similar";
import type { Idea } from "./types";

describe("similar ideas matching", () => {
  it("counts words correctly", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("hello world")).toBe(2);
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  lots   of   spaces   here  ")).toBe(4);
  });

  it("tokenizes and removes stop words and short tokens", () => {
    expect(tokenizeText("Please add dark mode for the app")).toEqual(["dark", "mode", "app"]);
    expect(tokenizeText("a in of to")).toEqual([]);
  });

  it("checks word similarity with sameWord", () => {
    expect(sameWord("notification", "notifications")).toBe(true);
    expect(sameWord("filter", "filtering")).toBe(true);
    expect(sameWord("dark", "light")).toBe(false);
  });

  it("returns empty array when fewer than 3 words typed", () => {
    const ideas: Idea[] = [
      { id: 1, product: "alpha", text: "Dark mode for the dashboard", status: "under-review", votes: 10 },
    ];
    expect(findSimilarIdeas("dark mode", "alpha", ideas)).toEqual([]);
  });

  it("matches similar ideas for matching product only", () => {
    const ideas: Idea[] = [
      { id: 1, product: "alpha", text: "Dark mode for the dashboard", status: "under-review", votes: 10 },
      { id: 2, product: "beta", text: "Dark mode for mobile", status: "planned", votes: 20 },
      { id: 3, product: "alpha", text: "Export data to CSV", status: "building", votes: 5 },
    ];

    const results = findSimilarIdeas("please add dark mode options", "alpha", ideas);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it("ranks by match score, then vote count, and limits to 3", () => {
    const ideas: Idea[] = [
      { id: 1, product: "alpha", text: "Dark mode theme", status: "under-review", votes: 5 },
      { id: 2, product: "alpha", text: "Dark mode dashboard toggle", status: "planned", votes: 15 },
      { id: 3, product: "alpha", text: "Dark mode and export", status: "building", votes: 25 },
      { id: 4, product: "alpha", text: "Dark mode with high contrast theme settings", status: "planned", votes: 30 },
    ];

    const results = findSimilarIdeas("dark mode theme contrast settings", "alpha", ideas);
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(4); // highest score
  });
});
