import { expect, it } from "vitest";
import {
  answer,
  branchesOf,
  failed,
  fakeGh,
  fieldsOf,
  node,
  numbersOf,
  ok,
  REPO,
} from "./fake.test-helper.js";
import { Missing } from "./gh.js";
import { asksOf, bucketOf, queryOf, readRepo, type Read } from "./pulls.js";

const WEB = { host: "github.com", owner: "orbit", name: "web" };
const INFRA = { host: "ghe.corp.example", owner: "platform", name: "infra" };

function read(value: Awaited<ReturnType<typeof readRepo>>): Read {
  if ("trouble" in value) throw new Error(`trouble: ${value.trouble.kind}`);
  return value;
}

it("asks each repository once, for its numbers and its branches", () => {
  const asks = asksOf(
    [
      { ...REPO, number: 41 },
      { ...WEB, number: 3 },
      { ...REPO, number: 41 },
      { ...REPO, number: 44 },
    ],
    [
      { repo: REPO, branch: "retry-upload" },
      { repo: INFRA, branch: "vpc" },
    ],
  );

  expect(asks).toEqual([
    { ...REPO, numbers: [41, 44], branches: ["retry-upload"] },
    { ...WEB, numbers: [3], branches: [] },
    { ...INFRA, numbers: [], branches: ["vpc"] },
  ]);
});

it("puts every number and branch in one query, and the branches as variables", () => {
  const { fields } = queryOf({
    ...REPO,
    numbers: [41, 44, 41, -1],
    branches: ["retry-upload", "it's\"odd"],
  });

  expect(numbersOf(fields)).toEqual([41, 44]);
  expect(branchesOf(fields)).toEqual(["retry-upload", `it's"odd`]);
  expect(fieldsOf(fields).get("owner")).toBe("orbit");
  expect(fieldsOf(fields).get("name")).toBe("api");
  expect(fieldsOf(fields).get("query")).not.toContain("it's");
});

it("reads a repository in one gh call for its host", async () => {
  const gh = fakeGh(() =>
    ok(
      answer({
        numbers: [
          node({
            number: 41,
            checks: [
              { name: "test", workflow: "CI" },
              { name: "lint", workflow: "CI", conclusion: "FAILURE" },
              { name: "deploy", status: "IN_PROGRESS", conclusion: null },
            ],
            statuses: [{ context: "ci/legacy", state: "SUCCESS" }],
            reviews: [
              {
                login: "grace",
                name: "Grace Hopper",
                state: "CHANGES_REQUESTED",
                submittedAt: "2026-11-20T09:00:00Z",
              },
            ],
            asked: [{ login: "linus" }, { team: "Platform" }],
            reviewDecision: "CHANGES_REQUESTED",
          }),
        ],
        branches: [[node({ number: 44, headRefName: "vpc-peering" })]],
        permission: "MAINTAIN",
        method: "REBASE",
        allowed: ["squash", "rebase"],
        remaining: 4321,
      }),
    ),
  );

  const found = read(
    await readRepo(gh, { ...REPO, numbers: [41], branches: ["vpc-peering"] }),
  );

  expect(gh.calls).toHaveLength(1);
  expect(gh.calls[0]?.args.slice(0, 4)).toEqual([
    "api",
    "graphql",
    "--hostname",
    "github.com",
  ]);
  expect(gh.calls[0]?.where).toEqual({ host: "github.com" });
  expect(found.rights).toEqual({ permission: "MAINTAIN", method: "rebase" });
  expect(found.viewer).toBe("ada");
  expect(found.rate).toEqual({
    remaining: 4321,
    resetAt: Date.parse("2026-11-20T11:00:00Z"),
  });
  expect(found.branches).toEqual(
    new Map([["vpc-peering", ["github.com/orbit/api#44"]]]),
  );
  const pull = found.pulls.get("github.com/orbit/api#41");
  expect(pull).toMatchObject({
    number: 41,
    url: "https://github.com/orbit/api/pull/41",
    state: "OPEN",
    head: "retry-upload",
    headOid: "a1b2c3",
    headRepo: REPO,
    base: "main",
    mergeable: "MERGEABLE",
    mergeState: "CLEAN",
    decision: "CHANGES_REQUESTED",
    asked: ["linus", "Platform"],
    closedAt: null,
  });
  expect(pull?.checks).toEqual([
    { name: "CI / test", bucket: "pass" },
    { name: "CI / lint", bucket: "fail" },
    { name: "deploy", bucket: "pending" },
    { name: "ci/legacy", bucket: "pass" },
  ]);
  expect(pull?.reviews).toEqual([
    {
      login: "grace",
      who: "Grace Hopper",
      state: "CHANGES_REQUESTED",
      at: Date.parse("2026-11-20T09:00:00Z"),
    },
  ]);
});

it("keeps only the newest run of a check that ran again", () => {
  const gh = fakeGh(() =>
    ok(
      answer({
        numbers: [
          node({
            number: 41,
            checks: [
              {
                name: "test",
                conclusion: "FAILURE",
                startedAt: "2026-11-20T09:00:00Z",
              },
              {
                name: "test",
                conclusion: "SUCCESS",
                startedAt: "2026-11-20T09:30:00Z",
              },
            ],
          }),
        ],
      }),
    ),
  );

  return readRepo(gh, { ...REPO, numbers: [41], branches: [] }).then(
    (value) => {
      expect(read(value).pulls.get("github.com/orbit/api#41")?.checks).toEqual([
        { name: "test", bucket: "pass" },
      ]);
    },
  );
});

it("reads when a pull request was merged or closed, and a head that is gone", async () => {
  const gh = fakeGh(() =>
    ok(
      answer({
        numbers: [
          node({
            number: 41,
            state: "MERGED",
            mergedAt: "2026-11-19T12:00:00Z",
            closedAt: "2026-11-19T12:00:00Z",
            headRepository: null,
          }),
          node({
            number: 44,
            state: "CLOSED",
            closedAt: "2026-11-18T08:00:00Z",
          }),
          null,
        ],
      }),
    ),
  );

  const found = read(
    await readRepo(gh, { ...REPO, numbers: [41, 44, 99], branches: [] }),
  );

  expect(found.pulls.get("github.com/orbit/api#41")).toMatchObject({
    state: "MERGED",
    closedAt: Date.parse("2026-11-19T12:00:00Z"),
    headRepo: null,
  });
  expect(found.pulls.get("github.com/orbit/api#44")).toMatchObject({
    state: "CLOSED",
    closedAt: Date.parse("2026-11-18T08:00:00Z"),
  });
  expect(found.pulls.has("github.com/orbit/api#99")).toBe(false);
});

it("puts gh's states for a check into its buckets", () => {
  expect(bucketOf("SUCCESS")).toBe("pass");
  expect(bucketOf("NEUTRAL")).toBe("skipping");
  expect(bucketOf("SKIPPED")).toBe("skipping");
  for (const state of ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"]) {
    expect(bucketOf(state)).toBe("fail");
  }
  for (const state of ["IN_PROGRESS", "QUEUED", "PENDING", "EXPECTED"]) {
    expect(bucketOf(state)).toBe("pending");
  }
});

it("says gh is missing when it cannot be started", async () => {
  const gh = fakeGh(() => new Missing());

  expect(await readRepo(gh, { ...REPO, numbers: [1], branches: [] })).toEqual({
    trouble: { kind: "missing" },
  });
});

it("says a host is signed out when gh has no sign-in for it", async () => {
  const gh = fakeGh(() =>
    failed(
      "You are not logged into any GitHub hosts. To log in, run: gh auth login",
      4,
    ),
  );

  expect(await readRepo(gh, { ...INFRA, numbers: [1], branches: [] })).toEqual({
    trouble: { kind: "signed-out", host: "ghe.corp.example" },
  });
});

it("says a host is rate limited, and until when when GitHub says", async () => {
  const limited = fakeGh(() => ({
    stdout: JSON.stringify({
      data: {
        rateLimit: { remaining: 0, resetAt: "2026-11-20T11:00:00Z" },
        repository: null,
      },
      errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }],
    }),
    stderr: "gh: API rate limit exceeded",
    code: 1,
  }));
  const secondary = fakeGh(() =>
    failed("HTTP 403: You have exceeded a secondary rate limit"),
  );

  expect(
    await readRepo(limited, { ...REPO, numbers: [1], branches: [] }),
  ).toEqual({
    trouble: {
      kind: "limited",
      host: "github.com",
      until: Date.parse("2026-11-20T11:00:00Z"),
    },
  });
  expect(
    await readRepo(secondary, { ...REPO, numbers: [1], branches: [] }),
  ).toEqual({ trouble: { kind: "limited", host: "github.com", until: null } });
});

it("says what GitHub said when a repository cannot be read", async () => {
  const gone = fakeGh(() => ({
    stdout: JSON.stringify({
      data: { repository: null },
      errors: [
        {
          message:
            "Could not resolve to a Repository with the name 'orbit/api'.",
        },
      ],
    }),
    stderr: "",
    code: 1,
  }));
  const nothing = fakeGh(() => ok(""));

  expect(await readRepo(gone, { ...REPO, numbers: [1], branches: [] })).toEqual(
    {
      trouble: {
        kind: "failed",
        host: "github.com",
        text: "Could not resolve to a Repository with the name 'orbit/api'.",
      },
    },
  );
  expect(
    await readRepo(nothing, { ...REPO, numbers: [1], branches: [] }),
  ).toMatchObject({ trouble: { kind: "failed", host: "github.com" } });
});
