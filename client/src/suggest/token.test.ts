import { describe, it, expect, beforeEach } from "vitest";
import {
  parseVoteToken,
  isTokenExpired,
  extractHashToken,
  getStoredToken,
  saveStoredToken,
  removeStoredToken,
  signinUrl,
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

  it("rejects a string exp, like the service", () => {
    const payload = { product: "beta", uid: "u456", exp: "1700000000" };
    expect(parseVoteToken(`${b64url(JSON.stringify(payload))}.sig`)).toBeNull();
  });

  it("decodes a UTF-8 payload", () => {
    const payload = { product: "café", uid: "ü1", exp: 1700000000 };
    expect(parseVoteToken(`${b64url(JSON.stringify(payload))}.sig`)).toEqual(payload);
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

describe("signinUrl", () => {
  const back = "https://office.example.com/";
  it("adds the return address to an https link", () => {
    expect(signinUrl("https://app.example.com/vote", back)).toBe(
      "https://app.example.com/vote?return=https%3A%2F%2Foffice.example.com%2F"
    );
  });
  it("keeps existing query and fragment in place", () => {
    expect(signinUrl("https://app.example.com/v?a=1#x", back)).toBe(
      "https://app.example.com/v?a=1&return=https%3A%2F%2Foffice.example.com%2F#x"
    );
  });
  it("refuses anything but an https URL", () => {
    for (const bad of ["javascript:alert(1)", "http://app.example.com/v", "data:text/html,x", "//app.example.com", "", 42, null, undefined]) {
      expect(signinUrl(bad, back)).toBeNull();
    }
  });
});

describe("extractHashToken", () => {
  it("returns null for a malformed escape instead of throwing", () => {
    expect(extractHashToken("#suggest-token=%E0%A4%A")).toBeNull();
  });
});
