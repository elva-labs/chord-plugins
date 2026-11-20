import { expect, it } from "vitest";
import { pull } from "./fake.test-helper.js";
import { notice, type Seen } from "./notices.js";
import type { Check, Pull } from "./pulls.js";

const NOW = Date.parse("2026-11-20T10:30:00Z");

const pass = (name: string): Check => ({ name, bucket: "pass" });
const fail = (name: string): Check => ({ name, bucket: "fail" });
const running = (name: string): Check => ({ name, bucket: "pending" });

function review(
  login: string,
  state: string,
  at = NOW,
): Pull["reviews"][number] {
  return { login, who: login === "grace" ? "Grace Hopper" : login, state, at };
}

/** Feeds a pull request's states in turn, and answers with every line told. */
function told(
  states: Partial<Pull>[],
  viewer: string | null = "ada",
): string[][] {
  let seen: Seen | undefined;
  return states.map((over) => {
    const result = notice(seen, pull(over), viewer);
    seen = result.seen;
    return result.lines;
  });
}

it("tells nothing the first time it sees a pull request, however it stands", () => {
  expect(
    told([
      {
        checks: [fail("lint")],
        reviews: [review("grace", "CHANGES_REQUESTED")],
      },
    ]),
  ).toEqual([[]]);
  expect(told([{ state: "MERGED" }])).toEqual([[]]);
});

it("tells when checks fail, once, naming the check", () => {
  expect(
    told([
      { checks: [running("lint"), pass("test")] },
      { checks: [fail("CI / lint"), pass("test")] },
      { checks: [fail("CI / lint"), pass("test")] },
    ]),
  ).toEqual([[], ["#42 check failed: CI / lint"], []]);
});

it("tells how many checks failed when more than one did", () => {
  expect(
    told([
      { checks: [running("lint")] },
      { checks: [fail("lint"), fail("test")] },
    ]),
  ).toEqual([[], ["#42 2 checks failed"]]);
});

it("tells again when checks fail on a new head", () => {
  expect(
    told([
      { checks: [fail("lint")] },
      { checks: [fail("lint")], headOid: "d4e5f6" },
    ]),
  ).toEqual([[], ["#42 check failed: lint"]]);
});

it("tells when checks pass after failing, even with a run in between", () => {
  expect(
    told([
      { checks: [fail("lint")] },
      { checks: [running("lint")], headOid: "d4e5f6" },
      { checks: [pass("lint")], headOid: "d4e5f6" },
      { checks: [pass("lint")], headOid: "d4e5f6" },
    ]),
  ).toEqual([[], [], ["#42 checks pass again"], []]);
});

it("tells nothing when checks pass that never failed", () => {
  expect(
    told([{ checks: [running("lint")] }, { checks: [pass("lint")] }]),
  ).toEqual([[], []]);
});

it("tells each review given, once, and never the user's own", () => {
  expect(
    told([
      { reviews: [review("ada", "COMMENTED")] },
      {
        reviews: [
          review("ada", "APPROVED"),
          review("grace", "CHANGES_REQUESTED"),
        ],
      },
      {
        reviews: [
          review("grace", "CHANGES_REQUESTED"),
          review("linus", "COMMENTED"),
        ],
      },
      {
        reviews: [
          review("grace", "APPROVED", NOW + 60_000),
          review("linus", "COMMENTED"),
          review("ken", "PENDING"),
        ],
      },
    ]),
  ).toEqual([
    [],
    ["#42 changes requested by Grace Hopper"],
    ["#42 reviewed by linus"],
    ["#42 approved by Grace Hopper"],
  ]);
});

it("tells nothing of reviews already there the first time it is seen", () => {
  expect(
    told([
      { reviews: [review("grace", "APPROVED")] },
      { reviews: [review("grace", "APPROVED")] },
    ]),
  ).toEqual([[], []]);
});

it("tells when a pull request is merged or closed, and nothing of its checks then", () => {
  expect(
    told([
      {},
      { state: "MERGED", checks: [fail("lint")] },
      { state: "MERGED" },
    ]),
  ).toEqual([[], ["#42 merged into main"], []]);
  expect(told([{}, { state: "CLOSED" }])).toEqual([[], ["#42 closed"]]);
});

it("tells several changes at once in the order they matter", () => {
  expect(
    told([
      { checks: [running("lint")] },
      {
        checks: [fail("lint")],
        reviews: [review("grace", "CHANGES_REQUESTED")],
      },
    ]),
  ).toEqual([
    [],
    ["#42 check failed: lint", "#42 changes requested by Grace Hopper"],
  ]);
});
