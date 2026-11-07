# Brief: Factory Office prototype v2, built on the Habblaud fork

## Goal
The owner sent v1 back: "why don't you fork habblaud and use its style". v1 redrew Habblaud by hand.
v2 IS Habblaud: the real client (world, sprites, rooms, sidebar, drawer, feed, styles), running in
the browser on mock factory data. No redrawing, no new art style.

## Where
Worktree `~/github/habblaud-wt-office`, branch `factory/feat/office-on-habblaud` (already checked out).
Habblaud is MIT (keep LICENSE and copyright). Read first: `README.md`, `shared/types.ts`
(OfficeSnapshot, RoomInfo, AgentInfo, AccountInfo, FeedItem), `shared/demo/simulator.ts`
(the in-browser demo that `?mock=1` runs), `client/src/net/store.ts` (`startMock`,
`mockOptionsFrom`), `client/src/main.ts`, `shared/i18n/` (English exists: use `lang=en`).

## What to build
1. **Factory mock mode `?factory=1`** (keep `?mock=1` working unchanged). A new pure module
   `shared/demo/factory.ts` with a `FactorySimulator` that has the same `snapshot()` / `tick()` shape
   as `DemoSimulator`, so `startMock` can pick it when the query has `factory=1`. Reuse
   DemoSimulator helpers where they fit; do not fork the whole file.
2. **Mock data = the factory's world**, not Claude Code sessions:
   - Rooms = factory projects (9): "New fee engine", "Support bot", "Black Friday 2026",
     "Clip2Earn V2", "Release manager", "Software factory", "AuraStack store", "Kick to YouTube",
     "Design system". Room names carry the product (bakchich, aurastack, clip2earn, factory, kick-yt).
   - ~18 agents with handles like `1a3f`, `2b07`, `3c11` as names; providers Claude, Antigravity,
     OpenCode as accounts (AccountInfo with 5 h / weekly usage; at least one account out of quota).
   - Factory states map onto Habblaud states: running -> working (at the desk, typing, real
     activity text like "Editing digest.py", "Running tests"); waiting on the owner -> waiting
     (raised hand); failed -> working with an error activity; stalled -> idle; quota -> idle at the
     kitchen if Habblaud supports it, otherwise idle; done -> done (leaves). Subagents (handles
     starting with 3) are `kind: 'sub'` of a parent in the same room.
   - Feed events in English: "2b07 opened PR #70", "1a3f is waiting on you".
   - `tick()` moves 1-2 agents between states every ~20 s so the office stays alive.
3. **Factory chrome, minimum**: page title "Factory Office", English UI, and a "Back to dashboard"
   link in the top bar (href `../`). Hide or disable Habblaud features that need its server
   (terminal, messages, character editor, timelapse, update check) when `factory=1`, the same way
   `mock` already does. Nothing else changes in look.
4. **One self-contained HTML file**: `npm ci`, `npm run build:client`, then inline the built JS, CSS
   and every asset (data URIs, or base64 in the JS) into
   `~/factory-pages/proto-office/factory-office-v2.html` with a small script
   `scripts/inline-build.mjs` (stdlib + what is installed, no new dependency unless vite-plugin-
   singlefile is the only way; say which). The page must open from `file://` and from any static
   path, run `?factory=1` by default (no query needed), make no network calls.

## Out of scope
Real factory data, server changes, sounds, new art.

## Proof
- `npm test` and `npm run typecheck` green (add `shared/demo/factory.test.ts`: snapshot has 9 rooms,
  ~18 agents, at least one waiting, one sub, one out-of-quota account; tick changes something).
- Open the HTML in headless Chromium (Playwright from `~/github/bakchich-monorepo/node_modules`,
  `--no-sandbox`), wait 3 s, screenshots in `~/factory-pages/proto-office/`: `v2-1440.png`,
  `v2-390.png`, `v2-drawer-1440.png` (click a waiting agent). No console errors, no network requests
  (log any request that is not data:/blob:).

## Return
Files changed, test + typecheck output, the screenshot paths, the HTML size. Commit on the branch as
author gharbimelek92@gmail.com. Do not push.
