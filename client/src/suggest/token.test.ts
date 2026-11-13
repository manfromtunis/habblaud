import { describe, it, expect, beforeEach } from "vitest";
import {
  parseVoteToken,
  isTokenExpired,
  extractHashToken,
  getStoredToken,
  saveStoredToken,
  removeStoredToken,
} from "./token";

function b64url(str: string): string {
  const b64 = (globalThis as unknown as { Buffer: { from(s: string, e: string): { toString(e: string): string } } }).Buffer.from(str, "utf-8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("token parsing and validation", () => {
  it("parses a valid token payload", () => {
    const payload = { product: "alpha", uid: "u123", exp: 1700000000 };
    const token = `${b64url(JSON.stringify(payload))}.${b64url("fakesig")}`;
    const parsed = parseVoteToken(token);
    expect(parsed).toEqual(payload);
  });

  it("handles string exp correctly", () => {
    const payload = { product: "beta", uid: "u456", exp: 1700000000 };
    const token = `${b64url(JSON.stringify(payload))}.sig`;
    const parsed = parseVoteToken(token);
    expect(parsed).toEqual({ product: "beta", uid: "u456", exp: 1700000000 });
  });

  it("returns null for malformed tokens", () => {
    expect(parseVoteToken("")).toBeNull();
    expect(parseVoteToken("nodotshere")).toBeNull();
    expect(parseVoteToken("a.b.c")).toBeNull();
    expect(parseVoteToken(".")).toBeNull();
    expect(parseVoteToken("badbase64!!!.sig")).toBeNull();
    expect(parseVoteToken(`${b64url("not json")}.sig`)).toBeNull();
    expect(parseVoteToken(`${b64url(JSON.stringify([]))}.sig`)).toBeNull();
    expect(parseVoteToken(`${b64url(JSON.stringify({ product: "", uid: "u1", exp: 123 }))}.sig`)).toBeNull();
    expect(parseVoteToken(`${b64url(JSON.stringify({ product: "p", uid: 123, exp: 123 }))}.sig`)).toBeNull();
    expect(parseVoteToken(`${b64url(JSON.stringify({ product: "p", uid: "u1", exp: "invalid" }))}.sig`)).toBeNull();
  });

  it("detects expired tokens", () => {
    const now = 1000;
    expect(isTokenExpired(999, now)).toBe(true);
    expect(isTokenExpired(1000, now)).toBe(true);
    expect(isTokenExpired(1001, now)).toBe(false);

    expect(isTokenExpired({ product: "p", uid: "u", exp: 999 }, now)).toBe(true);
    expect(isTokenExpired({ product: "p", uid: "u", exp: 1001 }, now)).toBe(false);
  });

  it("extracts token from URL hash", () => {
    expect(extractHashToken("#suggest-token=my-secret-token")).toBe("my-secret-token");
    expect(extractHashToken("suggest-token=my-secret-token")).toBe("my-secret-token");
    expect(extractHashToken("#foo=bar&suggest-token=token123&baz=1")).toBe("token123");
    expect(extractHashToken("#other-hash")).toBeNull();
    expect(extractHashToken("")).toBeNull();
  });
});

describe("sessionStorage token helpers", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    // @ts-expect-error mock sessionStorage
    globalThis.sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
  });

  it("saves, retrieves, and removes tokens", () => {
    const payload = { product: "alpha", uid: "u1", exp: 2000000000 };
    const token = `${b64url(JSON.stringify(payload))}.sig`;
    saveStoredToken("alpha", token);

    expect(getStoredToken("alpha", 1000000000)).toBe(token);
    expect(getStoredToken("beta", 1000000000)).toBeNull();

    removeStoredToken("alpha");
    expect(getStoredToken("alpha", 1000000000)).toBeNull();
  });

  it("drops expired stored tokens on retrieval", () => {
    const payload = { product: "alpha", uid: "u1", exp: 1000 };
    const token = `${b64url(JSON.stringify(payload))}.sig`;
    saveStoredToken("alpha", token);

    expect(getStoredToken("alpha", 2000)).toBeNull();
    expect(store.has("suggest-token-alpha")).toBe(false);
  });
});
