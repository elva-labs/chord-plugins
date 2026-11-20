import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { KEPT_CLOSED_MS } from "./mapping.js";
import {
  file,
  HOME,
  KEPT_SESSION_MS,
  MAX_PULLS,
  MAX_SESSIONS,
  Store,
} from "./store.js";

const NOW = Date.parse("2026-11-20T10:30:00Z");
const A41 = "github.com/orbit/api#41";
const A42 = "github.com/orbit/api#42";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "github-store-"));
  path = join(dir, "plugins", "github", "sessions.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("keeps the file under the home directory, or where the environment says", () => {
  const before = process.env[HOME];
  try {
    process.env[HOME] = "/srv/elsewhere";
    expect(file()).toBe(
      "/srv/elsewhere/.agent-workbench/plugins/github/sessions.json",
    );
    process.env[HOME] = "";
    expect(file()).toMatch(
      /\.agent-workbench\/plugins\/github\/sessions\.json$/,
    );
    expect(file()).not.toMatch(/^\/srv\/elsewhere/);
  } finally {
    if (before === undefined) delete process.env[HOME];
    else process.env[HOME] = before;
  }
});

it("gives a pull request to the session that made it and keeps it there", () => {
  const store = new Store(path);

  expect(store.claim("s1", A41, NOW, true)).toBe(true);
  expect(store.claim("s1", A41, NOW + 1, true)).toBe(false);
  expect(store.claim("s2", A41, NOW + 2, false)).toBe(false);
  expect(store.claims()).toEqual(new Map([["s1", [A41]]]));
});

it("moves a pull request to the session that made it, from one that only merged it", () => {
  const store = new Store(path);
  store.claim("merger", A41, NOW, false);
  store.claim("merger", A42, NOW, false);

  expect(store.claim("maker", A41, NOW + 1, true)).toBe(true);
  expect(store.claims()).toEqual(
    new Map([
      ["merger", [A42]],
      ["maker", [A41]],
    ]),
  );
  expect(store.claim("maker", A42, NOW + 2, true)).toBe(true);
  expect(store.claims()).toEqual(new Map([["maker", [A42, A41]]]));
});

it("lists a session's pull requests newest first", () => {
  const store = new Store(path);
  store.claim("s1", A41, NOW, true);
  store.claim("s1", A42, NOW + 1000, true);

  expect(store.claims().get("s1")).toEqual([A42, A41]);
});

it("lets go of a pull request a few days after it was merged or closed, and keeps one opened again", () => {
  const store = new Store(path);
  store.claim("s1", A41, NOW, true);
  store.claim("s1", A42, NOW + 1, true);

  expect(store.closed(A41, NOW)).toBe(true);
  expect(store.closed(A41, NOW)).toBe(false);
  expect(store.closed(A42, NOW)).toBe(true);
  expect(store.closed(A42, null)).toBe(true);
  store.prune(NOW + KEPT_CLOSED_MS - 1);
  expect(store.claims().get("s1")).toEqual([A42, A41]);
  store.prune(NOW + KEPT_CLOSED_MS);
  expect(store.claims().get("s1")).toEqual([A42]);
});

it("lets go of a session unseen for a month", () => {
  const store = new Store(path);
  store.claim("old", A41, NOW, true);
  store.claim("kept", A42, NOW, true);
  store.seen("kept", NOW + KEPT_SESSION_MS - 1);

  store.prune(NOW + KEPT_SESSION_MS);

  expect([...store.claims().keys()]).toEqual(["kept"]);
});

it("keeps no more pull requests and sessions than its caps, oldest going first", () => {
  const store = new Store(path);
  for (let at = 0; at < MAX_PULLS + 5; at++) {
    store.claim("busy", `github.com/orbit/api#${at}`, NOW + at, true);
  }
  for (let at = 0; at < MAX_SESSIONS + 5; at++) {
    store.claim(`s${at}`, `github.com/orbit/web#${at}`, NOW + at, true);
  }
  store.seen("busy", NOW + MAX_SESSIONS + 10);
  store.prune(NOW + MAX_SESSIONS + 10);

  const claims = store.claims();
  expect(claims.size).toBe(MAX_SESSIONS);
  expect(claims.get("busy")).toHaveLength(MAX_PULLS);
  expect(claims.get("busy")?.at(-1)).toBe("github.com/orbit/api#5");
  expect(claims.has("s0")).toBe(false);
  expect(claims.has("s5")).toBe(false);
  expect(claims.has("s6")).toBe(true);
});

it("writes the claims to disk and reads them back", async () => {
  const store = new Store(path);
  store.claim("s1", A41, NOW, true);
  store.claim("s1", A42, NOW + 1, true);
  store.closed(A41, NOW + 2);
  await Promise.all([store.save(), store.save()]);

  const again = new Store(path);
  await again.load(NOW + 3);

  expect(again.claims()).toEqual(new Map([["s1", [A42, A41]]]));
  await again.load(NOW + KEPT_CLOSED_MS + 2);
  expect(again.claims()).toEqual(new Map([["s1", [A42]]]));
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    version: 1,
  });
});

it("reads a missing or broken file as no claims, and skips what is not sound", async () => {
  const missing = new Store(path);
  await missing.load(NOW);
  expect(missing.claims()).toEqual(new Map());

  const broken = join(dir, "broken.json");
  await writeFile(broken, "{ not json", "utf8");
  const fromBroken = new Store(broken);
  await fromBroken.load(NOW);
  expect(fromBroken.claims()).toEqual(new Map());

  const odd = join(dir, "odd.json");
  await writeFile(
    odd,
    JSON.stringify({
      sessions: {
        s1: { seen: NOW, pulls: [{ key: A41, at: NOW }, { key: 7 }, null] },
        s2: { seen: "yesterday", pulls: [] },
        s3: null,
      },
    }),
    "utf8",
  );
  const fromOdd = new Store(odd);
  await fromOdd.load(NOW);
  expect(fromOdd.claims()).toEqual(new Map([["s1", [A41]]]));
});
