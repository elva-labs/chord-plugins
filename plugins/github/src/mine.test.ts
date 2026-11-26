import { expect, it } from "vitest";
import {
  failed,
  fakeGh,
  fieldsOf,
  node,
  ok,
  REPO,
} from "./fake.test-helper.js";
import { Missing } from "./gh.js";
import { MAX_MINE, mineArgs, readMine } from "./mine.js";

const found = (nodes: unknown[]) =>
  ok(
    JSON.stringify({
      data: {
        rateLimit: { remaining: 4800, resetAt: "2026-11-20T11:00:00Z" },
        search: { nodes },
      },
    }),
  );

it("searches one repository on its host for the user's open pull requests", async () => {
  const repo = { ...REPO, host: "ghe.corp.example" };
  const gh = fakeGh(() => found([]));
  await readMine(gh, repo);
  const call = gh.calls[0]!;
  expect(call.args).toEqual(mineArgs(repo));
  expect(call.where).toEqual({ host: "ghe.corp.example" });
  expect(fieldsOf(call.args).get("q")).toBe(
    "is:pr is:open author:@me repo:orbit/api sort:created-desc",
  );
  expect(fieldsOf(call.args).get("query")).toContain(`first: ${MAX_MINE}`);
});

it("reads titles and names as plain words, and rebuilds each address", async () => {
  const gh = fakeGh(() =>
    found([
      {
        ...node({
          number: 50,
          title: "Cache\n`the` \u202etoken",
          reviews: [
            {
              login: "grace",
              name: "@Grace\nHopper",
              state: "APPROVED",
              submittedAt: "2026-11-20T09:00:00Z",
            },
          ],
          asked: [{ login: "linus", name: "***" }, { team: "-core" }],
        }),
        url: "https://evil.example/50",
      },
      node({ number: 51, title: "\u200b" }),
    ]),
  );
  const read = await readMine(gh, REPO);
  if ("trouble" in read) throw new Error("trouble");
  expect(read.rate?.remaining).toBe(4800);
  expect(read.pulls[0]).toMatchObject({
    title: "Cache 'the' token",
    url: "https://github.com/orbit/api/pull/50",
    reviews: [{ who: "Grace Hopper" }],
    asked: ["core"],
  });
  expect(read.pulls[1]?.title).toBe("#51");
});

it("leaves out what is not a pull request", async () => {
  const gh = fakeGh(() => found([node({ number: 1 }), null, {}]));
  const read = await readMine(gh, REPO);
  if ("trouble" in read) throw new Error("trouble");
  expect(read.pulls.map((pull) => pull.number)).toEqual([1]);
});

it("says what stood in the way", async () => {
  expect(
    await readMine(
      fakeGh(() => new Missing()),
      REPO,
    ),
  ).toEqual({
    trouble: { kind: "missing" },
  });
  expect(
    await readMine(
      fakeGh(() => failed("API rate limit exceeded")),
      REPO,
    ),
  ).toMatchObject({ trouble: { kind: "limited" } });
  expect(
    await readMine(
      fakeGh(() => failed("something broke")),
      REPO,
    ),
  ).toMatchObject({ trouble: { kind: "failed", text: "something broke" } });
  await expect(
    readMine(
      fakeGh(() => new Error("killed")),
      REPO,
    ),
  ).rejects.toThrow("killed");
});
