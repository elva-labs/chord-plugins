import { expect, it } from "vitest";
import { pull, REPO, session } from "./fake.test-helper.js";
import {
  branchKey,
  claimerOf,
  KEPT_CLOSED_MS,
  owned,
  owners,
  wanted,
  type Session,
  type World,
} from "./mapping.js";
import type { Place } from "./place.js";
import type { Pull } from "./pulls.js";

const NOW = Date.parse("2026-11-20T10:30:00Z");
const FORK = { host: "github.com", owner: "ada", name: "api" };
const TREE = "/srv/orbit/.worktrees/retry-upload";
const PLACE: Place = { base: REPO, remotes: [REPO, FORK] };

const A41 = "github.com/orbit/api#41";
const A42 = "github.com/orbit/api#42";
const A43 = "github.com/orbit/api#43";

interface Given {
  sessions?: Session[];
  claims?: Record<string, string[]>;
  places?: Record<string, Place | null>;
  pulls?: Pull[];
  branches?: Record<string, string[]>;
  now?: number;
}

function world(given: Given): World {
  return {
    sessions: new Map((given.sessions ?? []).map((one) => [one.id, one])),
    claims: new Map(Object.entries(given.claims ?? {})),
    places: new Map(Object.entries(given.places ?? {})),
    pulls: new Map((given.pulls ?? []).map((one) => [one.key, one])),
    branches: new Map(Object.entries(given.branches ?? {})),
    now: given.now ?? NOW,
  };
}

/** A session working in the worktree the app made for it. */
function made(id: string, over: Partial<Session> = {}): Session {
  return session({
    id,
    cwd: TREE,
    worktree: true,
    branch: "retry-upload",
    ...over,
  });
}

const ON_BRANCH = { [branchKey(REPO, "retry-upload")]: [A42] };

it("gives a pull request to the session that made it", () => {
  const w = world({
    sessions: [session({ id: "s1" }), session({ id: "s2" })],
    claims: { s1: [A41] },
    pulls: [pull({ number: 41 })],
  });

  expect(owned(w, "s1")).toEqual([A41]);
  expect(owned(w, "s2")).toEqual([]);
  expect(claimerOf(w, A41)).toBe("s1");
  expect(owners(w, A41)).toEqual(["s1"]);
});

it("shows a claimed pull request before it is read", () => {
  const w = world({ sessions: [session({ id: "s1" })], claims: { s1: [A41] } });

  expect(owned(w, "s1")).toEqual([A41]);
  expect(wanted(w).refs).toEqual([{ ...REPO, number: 41 }]);
});

it("gives a made worktree's session the pull request whose head is its branch", () => {
  const w = world({
    sessions: [made("s1")],
    places: { [TREE]: PLACE },
    pulls: [pull({ number: 42 })],
    branches: ON_BRANCH,
  });

  expect(owned(w, "s1")).toEqual([A42]);
  expect(wanted(w).branches).toEqual([{ repo: REPO, branch: "retry-upload" }]);
});

it("takes a branch's pull request from a fork that is one of the folder's remotes", () => {
  const w = world({
    sessions: [made("s1")],
    places: { [TREE]: PLACE },
    pulls: [pull({ number: 42, headRepo: FORK })],
    branches: ON_BRANCH,
  });

  expect(owned(w, "s1")).toEqual([A42]);
});

it("leaves a branch's pull request whose head is in a repository the folder has no remote for", () => {
  const w = world({
    sessions: [made("s1")],
    places: { [TREE]: PLACE },
    pulls: [
      pull({
        number: 42,
        headRepo: { host: "github.com", owner: "mallory", name: "api" },
      }),
    ],
    branches: ON_BRANCH,
  });

  expect(owned(w, "s1")).toEqual([]);
});

it("leaves a branch's pull request whose head is gone or is another branch", () => {
  const w = world({
    sessions: [made("s1")],
    places: { [TREE]: PLACE },
    pulls: [pull({ number: 42, headRepo: null })],
    branches: ON_BRANCH,
  });
  const other = world({
    sessions: [made("s1")],
    places: { [TREE]: PLACE },
    pulls: [pull({ number: 42, head: "retry-upload-2" })],
    branches: ON_BRANCH,
  });

  expect(owned(w, "s1")).toEqual([]);
  expect(owned(other, "s1")).toEqual([]);
});

it("never gives a pull request by folder alone", () => {
  const sessions = [
    session({ id: "plain", cwd: TREE, branch: "retry-upload" }),
    made("unknown", { branch: null }),
  ];
  const w = world({
    sessions,
    places: { [TREE]: PLACE },
    pulls: [pull({ number: 42 })],
    branches: ON_BRANCH,
  });

  expect(owned(w, "plain")).toEqual([]);
  expect(owned(w, "unknown")).toEqual([]);
  expect(wanted(w).branches).toEqual([]);
});

it("gives nothing by branch for a folder that is no checkout of a known host", () => {
  const w = world({
    sessions: [made("s1")],
    places: { [TREE]: null },
    pulls: [pull({ number: 42 })],
    branches: ON_BRANCH,
  });

  expect(owned(w, "s1")).toEqual([]);
  expect(wanted(w).branches).toEqual([]);
});

it("lets a claim win over a branch: the pull request stays with the session that made it", () => {
  const w = world({
    sessions: [session({ id: "maker" }), made("s1")],
    claims: { maker: [A42] },
    places: { [TREE]: PLACE },
    pulls: [pull({ number: 42 })],
    branches: ON_BRANCH,
  });

  expect(owned(w, "maker")).toEqual([A42]);
  expect(owned(w, "s1")).toEqual([]);
  expect(owners(w, A42)).toEqual(["maker"]);
});

it("gives a branch's pull request to the worktree's own session when it made it", () => {
  const w = world({
    sessions: [made("s1")],
    claims: { s1: [A42] },
    places: { [TREE]: PLACE },
    pulls: [pull({ number: 42 })],
    branches: ON_BRANCH,
  });

  expect(owned(w, "s1")).toEqual([A42]);
});

it("shows an unclaimed branch's pull request to both sessions sharing a folder and branch", () => {
  const w = world({
    sessions: [made("first"), made("resumed")],
    places: { [TREE]: PLACE },
    pulls: [pull({ number: 42 })],
    branches: ON_BRANCH,
  });

  expect(owned(w, "first")).toEqual([A42]);
  expect(owned(w, "resumed")).toEqual([A42]);
  expect(owners(w, A42)).toEqual(["first", "resumed"]);
  expect(wanted(w).branches).toHaveLength(1);
});

it("shows a claimed pull request only to the claimer among sessions sharing a folder and branch", () => {
  const w = world({
    sessions: [made("first"), made("resumed")],
    claims: { resumed: [A42] },
    places: { [TREE]: PLACE },
    pulls: [pull({ number: 42 })],
    branches: ON_BRANCH,
  });

  expect(owned(w, "first")).toEqual([]);
  expect(owned(w, "resumed")).toEqual([A42]);
});

it("puts claims first and lists each pull request once", () => {
  const w = world({
    sessions: [made("s1")],
    claims: { s1: [A41, A42] },
    places: { [TREE]: PLACE },
    pulls: [pull({ number: 41 }), pull({ number: 42 })],
    branches: { [branchKey(REPO, "retry-upload")]: [A42, A41] },
  });

  expect(owned(w, "s1")).toEqual([A41, A42]);
});

it("keeps a merged or closed pull request a few days, then lets it go", () => {
  const closed = (at: number): World =>
    world({
      sessions: [session({ id: "s1" })],
      claims: { s1: [A41, A43] },
      pulls: [
        pull({ number: 41, state: "MERGED", closedAt: at }),
        pull({ number: 43, state: "CLOSED", closedAt: null }),
      ],
    });

  expect(owned(closed(NOW - KEPT_CLOSED_MS + 1), "s1")).toEqual([A41, A43]);
  expect(owned(closed(NOW - KEPT_CLOSED_MS), "s1")).toEqual([A43]);
  expect(wanted(closed(NOW - KEPT_CLOSED_MS)).refs).toEqual([
    { ...REPO, number: 43 },
  ]);
});

it("shows a session only its own pull requests, not those of the sessions it started", () => {
  const w = world({
    sessions: [session({ id: "lead" }), session({ id: "child" })],
    claims: { lead: [A41], child: [A43] },
    pulls: [pull({ number: 41 }), pull({ number: 43 })],
  });

  expect(owned(w, "lead")).toEqual([A41]);
  expect(owners(w, A43)).toEqual(["child"]);
});

it("wants each claimed pull request and each branch once, whatever sessions want them", () => {
  const w = world({
    sessions: [made("s1"), made("s2"), session({ id: "s3" })],
    claims: { s1: [A41], s3: [A41, A43], gone: [A42] },
    places: { [TREE]: PLACE },
  });

  const want = wanted(w);
  expect(want.refs).toEqual([
    { ...REPO, number: 41 },
    { ...REPO, number: 43 },
  ]);
  expect(want.branches).toEqual([{ repo: REPO, branch: "retry-upload" }]);
});
