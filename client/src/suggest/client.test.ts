import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLook, postIdea, POST_TIMEOUT_MS, SuggestTimeoutError } from "./client";

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
    expect(parseLook({ fit: "", effort: "x" })).toBeNull();
    expect(parseLook({ fit: "x", effort: "  " })).toBeNull();
  });

  it("caps each line at 200 characters", () => {
    const look = parseLook({ fit: "a".repeat(500), effort: "b" });
    expect(look?.fit.length).toBe(200);
  });
});

describe("postIdea timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("gives up after POST_TIMEOUT_MS with a clear error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
    );
    const p = postIdea("alpha", "an idea that is long enough");
    const check = expect(p).rejects.toBeInstanceOf(SuggestTimeoutError);
    await vi.advanceTimersByTimeAsync(POST_TIMEOUT_MS);
    await check;
  });

  it("passes other network errors through", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(postIdea("alpha", "an idea that is long enough")).rejects.toThrow("Failed to fetch");
  });
});
