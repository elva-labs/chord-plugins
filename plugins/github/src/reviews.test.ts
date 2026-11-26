import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  KEPT_REVIEW_MS,
  keyOfRef,
  MAX_REVIEWS,
  refOf,
  Reviews,
} from "./reviews.js";

const KEY = "github.com/orbit/api#42";
const NOW = Date.parse("2026-11-20T10:30:00Z");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "github-reviews-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("names a review by its pull request's key in a ref, and nothing else", () => {
  expect(refOf(KEY)).toBe("review:github.com/orbit/api#42");
  expect(keyOfRef(refOf(KEY))).toBe(KEY);
  expect(keyOfRef("review:")).toBeNull();
  expect(keyOfRef("todo:1")).toBeNull();
  expect(keyOfRef(undefined)).toBeNull();
});

it("keeps which session reviewed what across a restart, not running until the app says so", async () => {
  const path = join(dir, "reviews.json");
  const reviews = new Reviews(path);
  expect(reviews.started(KEY, "s1", "/srv/orbit", NOW)).toBe(true);
  expect(reviews.started(KEY, "s1", "/srv/orbit", NOW)).toBe(false);
  await reviews.save();
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    version: 1,
    reviews: { [KEY]: { session: "s1", project: "/srv/orbit", at: NOW } },
  });

  const again = new Reviews(path);
  await again.load(NOW);
  expect(again.of(KEY)).toEqual({
    session: "s1",
    project: "/srv/orbit",
    at: NOW,
    live: false,
  });
  expect(again.keysOf("s1")).toEqual([KEY]);
  expect(again.started(KEY, "s1", "/srv/orbit", NOW + 5)).toBe(true);
  expect(again.of(KEY)?.at).toBe(NOW);
  expect(again.ended("s1")).toBe(true);
  expect(again.ended("s1")).toBe(false);
  again.given(KEY, NOW + 10);
  expect(again.of(KEY)).toMatchObject({ at: NOW + 10, live: true });
  again.drop(KEY);
  expect(again.of(KEY)).toBeNull();
});

it("reads a file that is not what it should be as no records", async () => {
  const path = join(dir, "reviews.json");
  await writeFile(
    path,
    JSON.stringify({
      reviews: {
        a: { session: 3 },
        b: null,
        c: { session: "s", project: "/p", at: NOW },
      },
    }),
  );
  const reviews = new Reviews(path);
  await reviews.load(NOW);
  expect(reviews.of("a")).toBeNull();
  expect(reviews.of("c")?.session).toBe("s");
  await writeFile(path, "not json");
  const none = new Reviews(path);
  await none.load(NOW);
  expect(none.of("c")).toBeNull();
});

it("lets a month-old record go, and past the cap the oldest first", () => {
  const reviews = new Reviews(join(dir, "reviews.json"));
  reviews.started("old", "s0", "/p", NOW - KEPT_REVIEW_MS);
  for (let at = 0; at <= MAX_REVIEWS; at++)
    reviews.started(`k${at}`, `s${at}`, "/p", NOW + at);
  expect(reviews.of("old")).toBeNull();
  expect(reviews.of("k0")).toBeNull();
  expect(reviews.of("k1")).not.toBeNull();
  expect(reviews.of(`k${MAX_REVIEWS}`)).not.toBeNull();
});
