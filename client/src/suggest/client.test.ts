import { describe, expect, it } from "vitest";
import { parseLook } from "./client";

describe("parseLook", () => {
  it("keeps the two service lines", () => {
    expect(parseLook({ fit: "Not on the public roadmap yet.", effort: "About a day", source: "jev" })).toEqual({
      fit: "Not on the public roadmap yet.",
      effort: "About a day",
    });
  });

  it("drops anything that is not two strings", () => {
    expect(parseLook(null)).toBeNull();
    expect(parseLook(undefined)).toBeNull();
    expect(parseLook("About a day")).toBeNull();
    expect(parseLook({ fit: "x" })).toBeNull();
    expect(parseLook({ fit: 1, effort: "x" })).toBeNull();
  });

  it("caps each line at 200 characters", () => {
    const look = parseLook({ fit: "a".repeat(500), effort: "b" });
    expect(look?.fit.length).toBe(200);
  });
});
