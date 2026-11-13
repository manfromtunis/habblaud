import type { VoteTokenPayload } from "./types";

export function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad) {
    base64 += "=".repeat(4 - pad);
  }
  if (typeof atob === "function") {
    return atob(base64);
  }
  const buf = (globalThis as unknown as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } }).Buffer;
  if (buf) {
    return buf.from(base64, "base64").toString("utf-8");
  }
  return "";
}

export function parseVoteToken(token: string): VoteTokenPayload | null {
  if (typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  try {
    const jsonStr = base64UrlDecode(parts[0]);
    const payload = JSON.parse(jsonStr) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

    const record = payload as Record<string, unknown>;
    const product = record.product;
    const uid = record.uid;
    const exp = record.exp;

    if (typeof product !== "string" || !product.trim()) return null;
    if (typeof uid !== "string") return null;
    const expNum = typeof exp === "number" ? exp : Number(exp);
    if (!Number.isFinite(expNum)) return null;

    return {
      product: product.trim(),
      uid,
      exp: expNum,
    };
  } catch {
    return null;
  }
}

export function isTokenExpired(
  payloadOrExp: VoteTokenPayload | number,
  nowSec: number = Date.now() / 1000
): boolean {
  const exp = typeof payloadOrExp === "number" ? payloadOrExp : payloadOrExp.exp;
  return exp <= nowSec;
}

export function extractHashToken(hash: string): string | null {
  if (!hash) return null;
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = cleaned.split("&");
  for (const p of params) {
    if (p.startsWith("suggest-token=")) {
      const val = p.slice("suggest-token=".length);
      return decodeURIComponent(val);
    }
  }
  return null;
}

const STORAGE_PREFIX = "suggest-token-";

export function getStoredToken(product: string, nowSec: number = Date.now() / 1000): string | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${product}`);
    if (!raw) return null;
    const payload = parseVoteToken(raw);
    if (!payload || payload.product !== product || isTokenExpired(payload, nowSec)) {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${product}`);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function saveStoredToken(product: string, token: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(`${STORAGE_PREFIX}${product}`, token);
  } catch {
    // sessionStorage might be restricted or full
  }
}

export function removeStoredToken(product: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(`${STORAGE_PREFIX}${product}`);
  } catch {
    // ignore
  }
}
