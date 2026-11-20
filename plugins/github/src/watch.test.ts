import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { pullKey, type Repo } from "./address.js";
import { detailOf, headerOf, rowsOf, timeOf } from "./app.js";
import {
  answer,
  branchesOf,
  failed,
  fakeGh,
  FakeClock,
  fieldsOf,
  node,
  numbersOf,
  ok,
  REPO,
  session,
  type Answer,
  type Call,
  type Node,
  type Script,
} from "./fake.test-helper.js";
import { Missing, type Run } from "./gh.js";
import type { Session } from "./mapping.js";
import { BASE_MS } from "./schedule.js";
import type { Tally } from "./standing.js";
import { Store } from "./store.js";
import { HOSTS_MS, SETTLE_MS, Watch } from "./watch.js";

const PROJECT = "/srv/orbit";
const TREE = "/srv/orbit/.worktrees/retry-upload";
const GHE: Repo = {
  host: "ghe.corp.example",
  owner: "platform",
  name: "infra",
};
const KEY = pullKey({ ...REPO, number: 42 });
const URL = "https://github.com/orbit/api/pull/42";

/** A GitHub that holds these pull requests and answers each read for what
    it asks, with the rest of the answer as given. Calls the test answers
    itself go first; one it leaves gets nothing. */
class Hub {
  pulls: Node[];
  rest: Answer;
  hosts: string[] = ["github.com"];
  other: ((call: Call) => Run | Error | undefined) | null = null;

  constructor(pulls: Node[] = [], rest: Answer = {}) {
    this.pulls = pulls;
    this.rest = rest;
  }

  readonly script: Script = (call) => {
    const own = this.other?.(call);
    if (own !== undefined) return own;
    const [first, second] = call.args;
    if (first === "auth" && second === "status") {
      return ok(
        JSON.stringify({
          hosts: Object.fromEntries(this.hosts.map((host) => [host, []])),
        }),
      );
    }
    if (first === "pr" && second === "merge") return ok("");
    if (first !== "api") return failed("not scripted");
    const host = call.args[call.args.indexOf("--hostname") + 1];
    const fields = fieldsOf(call.args);
    const here = this.pulls.filter((one) => {
      const repo = one.repo ?? REPO;
      return (
        repo.host === host &&
        repo.owner === fields.get("owner") &&
        repo.name === fields.get("name")
      );
    });
    return ok(
      answer({
        ...this.rest,
        numbers: numbersOf(call.args).map((number) => {
          const found = here.find((one) => one.number === number);
          return found === undefined ? null : node(found);
        }),
        branches: branchesOf(call.args).map((branch) =>
          here
            .filter((one) => (one.headRefName ?? "retry-upload") === branch)
            .map(node),
        ),
      }),
    );
  };
}

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A watch over a GitHub of these pull requests, whose folders all have
    the remotes given, with what it tells the app written down. */
function watching(
  hub = new Hub(),
  listing = "remote.origin.url git@github.com:orbit/api.git\n",
) {
  const dir = mkdtempSync(join(tmpdir(), "github-watch-"));
  made.push(dir);
  const path = join(dir, "pulls.json");
  const store = new Store(path);
  const clock = new FakeClock();
  const gh = fakeGh(hub.script);
  const folds: string[] = [];
  const marks: [string, Tally | null][] = [];
  const notes: [string, string][] = [];
  const looked: string[] = [];
  const watch = new Watch({
    gh,
    remotes: async (cwd) => {
      looked.push(cwd);
      return listing;
    },
    store,
    clock,
    out: {
      fold: (_project, id) => folds.push(id),
      mark: (_project, id, tally) => marks.push([id, tally]),
      notify: (_project, id, text) => notes.push([id, text]),
    },
  });
  const reads = () => gh.calls.filter((call) => call.args[0] === "api");
  const detail = (id: string) => detailOf(watch.viewOf(id));
  return {
    hub,
    watch,
    gh,
    clock,
    store,
    path,
    folds,
    marks,
    notes,
    looked,
    reads,
    detail,
  };
}

/** Tells a watch of sessions and lets the read that follows run. */
async function tell(
  at: ReturnType<typeof watching>,
  ...sessions: Session[]
): Promise<void> {
  for (const one of sessions) at.watch.told(one);
  await at.clock.move(SETTLE_MS);
}

function created(id: string, url = URL) {
  return {
    project: PROJECT,
    session: id,
    cwd: PROJECT,
    command: "gh pr create --fill",
    ok: true,
    output: `Creating pull request for retry-upload into main\n\n${url}\n`,
  };
}

it("shows the pull request a session made, read once from its repository, and keeps it on disk", async () => {
  const at = watching(new Hub([{ number: 42, checks: [{ name: "lint" }] }]));
  await tell(at, session({ id: "ada" }));
  expect(at.gh.calls).toEqual([]);
  expect(at.folds).toEqual([]);

  await at.watch.heard(created("ada"));

  expect(at.reads()).toHaveLength(1);
  const call = at.reads()[0] as Call;
  expect(call.args.slice(0, 4)).toEqual([
    "api",
    "graphql",
    "--hostname",
    "github.com",
  ]);
  expect(call.where.host).toBe("github.com");
  expect(numbersOf(call.args)).toEqual([42]);
  expect(rowsOf(at.watch.viewOf("ada")).map((row) => row.id)).toEqual([
    `pr:${KEY}`,
  ]);
  expect(at.detail("ada")).toBeNull();
  expect(headerOf(at.watch.viewOf("ada"))).toEqual([
    { id: "refresh", label: "Refresh" },
  ]);
  expect(at.folds).toEqual(["ada"]);
  expect(at.marks).toEqual([
    ["ada", { count: 1, state: "ok", label: "1 pull request, all well" }],
  ]);
  expect(at.clock.next).toBe(at.clock.now() + BASE_MS);

  const again = new Store(at.path);
  await again.load(at.clock.now());
  expect(again.claims().get("ada")).toEqual([KEY]);
});

/** Answers `gh pr view` with this pull request, made at this time. */
function viewing(hub: Hub, url: string, createdAt: string): void {
  hub.other = (call) =>
    call.args[0] === "pr" && call.args[1] === "view"
      ? ok(JSON.stringify({ url, createdAt }))
      : undefined;
}

const views = (at: ReturnType<typeof watching>) =>
  at.gh.calls.filter((call) => call.args[1] === "view");

/** A `gh pr create` whose output was held back, run in the worktree. */
function held(id: string) {
  return {
    ...created(id),
    command: "gh pr create --fill --head retry-upload",
    cwd: TREE,
    output: null,
  };
}

it("looks the pull request up where a create ran when its output was held back", async () => {
  const hub = new Hub([{ number: 42 }]);
  const at = watching(hub);
  viewing(hub, URL, "2026-11-20T10:29:00Z");

  await at.watch.heard(held("ada"));

  expect(views(at)).toEqual([
    {
      args: ["pr", "view", "retry-upload", "--json", "url,createdAt"],
      where: { cwd: TREE },
    },
  ]);
  expect(at.store.claims().get("ada")).toEqual([KEY]);
});

it("claims nothing it looked up that was made a while ago, or that another session has", async () => {
  const hub = new Hub([{ number: 42 }]);
  const at = watching(hub);
  await tell(at, session({ id: "ada" }), session({ id: "grace" }));

  viewing(hub, URL, "2026-11-20T10:15:00Z");
  await at.watch.heard(held("ada"));
  expect(at.store.claims().size).toBe(0);

  await at.watch.heard(created("grace"));
  viewing(hub, URL, "2026-11-20T10:29:00Z");
  await at.watch.heard(held("ada"));
  expect(at.store.claims()).toEqual(new Map([["grace", [KEY]]]));
  expect(at.watch.viewOf("ada").lines).toEqual([]);
});

it("takes nothing by looking from a made worktree whose branch shows it", async () => {
  const hub = new Hub([{ number: 42 }]);
  const at = watching(hub);
  await tell(
    at,
    session({ id: "ada", cwd: TREE, worktree: true, branch: "retry-upload" }),
    session({ id: "grace", cwd: TREE }),
  );
  expect(at.watch.viewOf("ada").lines.map((line) => line.pull.key)).toEqual([
    KEY,
  ]);

  viewing(hub, URL, "2026-11-20T10:29:00Z");
  await at.watch.heard(held("grace"));

  expect(at.store.claims().size).toBe(0);
  expect(at.watch.viewOf("ada").lines).toHaveLength(1);
  expect(at.watch.viewOf("grace").lines).toEqual([]);
});

it("claims nothing for a create that failed, or that found its pull request already there", async () => {
  const at = watching(new Hub([{ number: 42 }]));
  const exists = `a pull request for branch "retry-upload" into branch "main" already exists:\n${URL}\n`;

  await at.watch.heard({ ...created("ada"), ok: false, output: exists });
  await at.watch.heard({
    ...created("ada"),
    command: "gh pr create --fill; echo done",
    output: `${exists}done\n`,
  });
  await at.watch.heard({ ...held("ada"), ok: false });

  expect(views(at)).toEqual([]);
  expect(at.store.claims().size).toBe(0);
});

it("claims nothing for a merge, close or ready, whatever its output names", async () => {
  const hub = new Hub([{ number: 42 }, { number: 43 }]);
  const at = watching(hub);
  viewing(hub, URL, "2026-11-20T10:29:00Z");
  await tell(at, session({ id: "ada" }), session({ id: "grace" }));

  await at.watch.heard(created("ada"));
  await at.watch.heard({
    ...created("grace"),
    command: "gh pr merge 42",
    output: `✓ Squashed and merged pull request ${URL}\n`,
  });
  await at.watch.heard({
    ...created("grace"),
    command: "gh pr close 43",
    output: "✓ Closed pull request https://github.com/orbit/api/pull/43\n",
  });
  await at.watch.heard({
    ...created("grace"),
    command: "gh pr ready 43 --repo orbit/api",
    output: null,
  });
  await at.watch.heard({
    ...created("grace"),
    command: `gh pr merge ${URL} --squash`,
    output: "",
  });

  expect(views(at)).toEqual([]);
  expect(at.store.claims()).toEqual(new Map([["ada", [KEY]]]));
  expect(at.watch.viewOf("grace").lines).toEqual([]);
});

it("shows a made worktree the pull requests of its branch, and never a plain folder on the same branch", async () => {
  const at = watching(new Hub([{ number: 42 }]));

  await tell(
    at,
    session({ id: "ada", cwd: TREE, worktree: true, branch: "retry-upload" }),
    session({
      id: "grace",
      cwd: TREE,
      worktree: false,
      branch: "retry-upload",
    }),
  );

  expect(at.looked).toEqual([TREE]);
  expect(at.reads()).toHaveLength(1);
  expect(branchesOf((at.reads()[0] as Call).args)).toEqual(["retry-upload"]);
  expect(numbersOf((at.reads()[0] as Call).args)).toEqual([]);
  expect(at.watch.viewOf("ada").lines.map((line) => line.pull.key)).toEqual([
    KEY,
  ]);
  expect(at.watch.viewOf("grace").lines).toEqual([]);
  expect(at.folds).toEqual(["ada"]);
});

it("reads the sessions told together in one call per repository", async () => {
  const at = watching(
    new Hub([{ number: 42 }, { number: 43, headRefName: "fix-auth" }]),
  );

  at.watch.told(
    session({ id: "ada", cwd: TREE, worktree: true, branch: "retry-upload" }),
  );
  await at.clock.move(SETTLE_MS / 2);
  at.watch.told(
    session({
      id: "grace",
      cwd: "/srv/orbit/.worktrees/fix-auth",
      worktree: true,
      branch: "fix-auth",
    }),
  );
  await at.clock.move(SETTLE_MS / 2);

  expect(at.reads()).toHaveLength(1);
  expect(branchesOf((at.reads()[0] as Call).args)).toEqual([
    "retry-upload",
    "fix-auth",
  ]);
  expect(
    at.watch.viewOf("grace").lines.map((line) => line.pull.number),
  ).toEqual([43]);
});

it("looks a branch up on another host only when gh says it is signed in there, and asks again a while later", async () => {
  const hub = new Hub([{ number: 9, repo: GHE }]);
  const listing = "remote.origin.url git@ghe.corp.example:platform/infra.git\n";
  const at = watching(hub, listing);
  const tree = session({
    id: "ada",
    cwd: TREE,
    worktree: true,
    branch: "retry-upload",
  });
  const asked = () =>
    at.gh.calls.filter((call) => call.args[0] === "auth").length;

  await tell(at, tree);
  expect(at.gh.calls.map((call) => call.args.slice(0, 2))).toEqual([
    ["auth", "status"],
  ]);
  expect(at.folds).toEqual([]);

  hub.hosts = ["github.com", "GHE.corp.example"];
  await at.clock.move(HOSTS_MS);

  expect(asked()).toBe(2);
  const reads = at.reads();
  expect(reads).toHaveLength(1);
  expect((reads[0] as Call).args.slice(2, 4)).toEqual([
    "--hostname",
    "ghe.corp.example",
  ]);
  expect(at.watch.viewOf("ada").lines.map((line) => line.pull.url)).toEqual([
    "https://ghe.corp.example/platform/infra/pull/9",
  ]);

  await at.clock.move(BASE_MS);
  expect(asked()).toBe(2);
  expect(at.reads()).toHaveLength(2);

  await at.watch.refresh();
  expect(asked()).toBe(3);
});

it("says on the fold when gh is not signed in to a host, with the command to run", async () => {
  const hub = new Hub();
  hub.other = (call) => (call.args[0] === "api" ? failed("", 4) : undefined);
  const at = watching(hub);

  await at.watch.heard(
    created("ada", "https://ghe.corp.example/platform/infra/pull/9"),
  );

  expect(at.detail("ada")).toBe(
    "Not signed in to ghe.corp.example. Run gh auth login --hostname ghe.corp.example in a terminal, then Try again.",
  );
  expect(headerOf(at.watch.viewOf("ada"))).toEqual([
    { id: "refresh", label: "Try again" },
  ]);
  expect(at.folds).toEqual(["ada"]);
  expect(at.clock.waiting).toBe(0);

  hub.other = null;
  hub.pulls = [{ number: 9, repo: GHE }];
  await at.watch.refresh();
  expect(at.detail("ada")).toBeNull();
});

it("says on the fold when gh is not on the PATH", async () => {
  const hub = new Hub();
  hub.other = () => new Missing();
  const at = watching(hub);

  await at.watch.heard(created("ada"));

  expect(at.detail("ada")).toBe(
    "gh is not on the PATH. Install the GitHub CLI (cli.github.com), then Try again.",
  );
});

it("says on the fold when gh failed, and tries again on its timer", async () => {
  const hub = new Hub([{ number: 42 }]);
  hub.other = (call) =>
    call.args[0] === "api" ? failed("HTTP 502: Bad Gateway") : undefined;
  const at = watching(hub);

  await at.watch.heard(created("ada"));
  expect(at.detail("ada")).toBe(
    "gh failed on github.com: HTTP 502: Bad Gateway",
  );
  expect(at.clock.next).toBe(at.clock.now() + BASE_MS);

  hub.other = null;
  await at.clock.move(BASE_MS);
  expect(at.detail("ada")).toBeNull();
});

it("leaves a host with few calls left alone until its limit lifts, and goes on reading the others", async () => {
  const hub = new Hub([{ number: 42 }, { number: 9, repo: GHE }], {
    remaining: 40,
    resetAt: "2026-11-20T10:42:00Z",
  });
  const at = watching(hub);
  const lifts = Date.parse("2026-11-20T10:42:01Z");
  const readOf = (host: string) =>
    at.reads().filter((call) => call.where.host === host).length;

  await at.watch.heard(created("ada"));

  expect(at.watch.viewOf("ada").lines).toHaveLength(1);
  expect(at.detail("ada")).toBeNull();
  expect(at.clock.next).toBe(at.clock.now() + BASE_MS);

  hub.rest = {};
  await at.watch.heard(
    created("grace", "https://ghe.corp.example/platform/infra/pull/9"),
  );
  await at.clock.move(BASE_MS);

  expect(readOf("github.com")).toBe(1);
  expect(readOf("ghe.corp.example")).toBe(2);
  expect(at.watch.viewOf("ada").lines).toHaveLength(1);
  expect(at.detail("ada")).toBe(
    `Rate limited on github.com until ${timeOf(lifts)}.`,
  );
  expect(at.detail("grace")).toBeNull();

  await at.clock.move(lifts - at.clock.now());
  expect(readOf("github.com")).toBe(2);
  expect(at.detail("ada")).toBeNull();
});

it("sends a fold and a mark again only when what they show changed", async () => {
  const hub = new Hub([
    {
      number: 42,
      checks: [{ name: "lint", status: "IN_PROGRESS", conclusion: null }],
    },
  ]);
  const at = watching(hub);

  await at.watch.heard(created("ada"));
  await at.clock.move(BASE_MS);
  expect(at.reads()).toHaveLength(2);
  expect(at.folds).toEqual(["ada"]);
  expect(at.marks.map(([, tally]) => tally?.state)).toEqual(["busy"]);

  hub.pulls = [
    { number: 42, checks: [{ name: "lint", conclusion: "FAILURE" }] },
  ];
  await at.clock.move(BASE_MS * 1.5);
  expect(at.folds).toEqual(["ada", "ada"]);
  expect(at.marks.map(([, tally]) => tally?.state)).toEqual(["busy", "failed"]);
});

it("tells the session once when its checks fail, and nothing of how it stood when first read", async () => {
  const hub = new Hub([
    {
      number: 42,
      checks: [{ name: "test", conclusion: "FAILURE" }],
      reviewDecision: "CHANGES_REQUESTED",
      reviews: [
        {
          login: "grace",
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-11-20T10:00:00Z",
        },
      ],
    },
  ]);
  const at = watching(hub);

  await at.watch.heard(created("ada"));
  expect(at.notes).toEqual([]);

  hub.pulls = [
    {
      number: 42,
      headRefOid: "d4e5f6",
      checks: [{ name: "lint", conclusion: "FAILURE" }],
    },
  ];
  await at.watch.refresh();
  await at.watch.refresh();
  expect(at.notes).toEqual([["ada", "#42 check failed: lint"]]);

  hub.pulls = [{ number: 42, state: "MERGED", headRefOid: "d4e5f6" }];
  await at.watch.refresh();
  expect(at.notes).toEqual([
    ["ada", "#42 check failed: lint"],
    ["ada", "#42 merged into main"],
  ]);
});

it("shows and tells a pull request only to the session that made it, not to the one that started that session", async () => {
  const hub = new Hub([{ number: 43, headRefName: "fix-auth" }]);
  const at = watching(hub);
  const key = pullKey({ ...REPO, number: 43 });
  await tell(
    at,
    session({ id: "lead" }),
    session({
      id: "child",
      cwd: "/srv/orbit/.worktrees/fix-auth",
      branch: "fix-auth",
    }),
  );

  await at.watch.heard(
    created("child", "https://github.com/orbit/api/pull/43"),
  );

  expect(at.watch.viewOf("child").lines.map((line) => line.pull.key)).toEqual([
    key,
  ]);
  expect(at.watch.viewOf("lead").lines).toEqual([]);
  expect(at.folds).toEqual(["child"]);
  expect(at.marks.map(([id]) => id)).toEqual(["child"]);
  await expect(at.watch.merge("lead", key)).rejects.toThrow(
    "that pull request is no longer shown",
  );

  hub.pulls = [
    {
      number: 43,
      headRefName: "fix-auth",
      checks: [{ name: "lint", conclusion: "FAILURE" }],
    },
  ];
  await at.watch.refresh();
  expect(at.notes).toEqual([["child", "#43 check failed: lint"]]);

  at.watch.ended("child");
  hub.pulls = [
    {
      number: 43,
      headRefName: "fix-auth",
      state: "CLOSED",
      closedAt: "2026-11-20T10:31:00Z",
    },
  ];
  await at.watch.refresh();

  expect(at.notes).toEqual([["child", "#43 check failed: lint"]]);
  expect(at.folds).toEqual(["child", "child"]);
});

it("lets go of the claims in a repository GitHub cannot find, and stops reading it", async () => {
  const hub = new Hub([{ number: 42 }]);
  const at = watching(hub);
  await at.watch.heard(created("ada"));
  expect(at.clock.waiting).toBe(1);

  hub.other = (call) =>
    call.args[0] === "api"
      ? {
          code: 1,
          stderr:
            "GraphQL: Could not resolve to a Repository with the name 'orbit/api'. (repository)",
          stdout: JSON.stringify({
            data: { repository: null },
            errors: [
              {
                type: "NOT_FOUND",
                path: ["repository"],
                message:
                  "Could not resolve to a Repository with the name 'orbit/api'.",
              },
            ],
          }),
        }
      : undefined;
  await at.watch.refresh();

  expect(at.store.claims().size).toBe(0);
  expect(at.watch.viewOf("ada")).toEqual({ lines: [], trouble: null });
  expect(at.marks.at(-1)).toEqual(["ada", null]);
  expect(at.clock.waiting).toBe(0);
  const again = new Store(at.path);
  await again.load(at.clock.now());
  expect(again.claims().size).toBe(0);
});

it("says a repository failed only on the sessions with pull requests in it", async () => {
  const WEB: Repo = { host: "github.com", owner: "orbit", name: "web" };
  const hub = new Hub([{ number: 42 }, { number: 5, repo: WEB }]);
  hub.other = (call) =>
    call.args[0] === "api" && fieldsOf(call.args).get("name") === "web"
      ? failed("HTTP 502: Bad Gateway")
      : undefined;
  const at = watching(hub);

  await at.watch.heard(created("ada", "https://github.com/orbit/web/pull/5"));
  await at.watch.heard(created("grace"));

  expect(at.detail("ada")).toBe(
    "gh failed on github.com: HTTP 502: Bad Gateway",
  );
  expect(at.detail("grace")).toBeNull();
  expect(at.watch.viewOf("grace").lines).toHaveLength(1);
  expect(headerOf(at.watch.viewOf("grace"))).toEqual([
    { id: "refresh", label: "Refresh" },
  ]);
});

it("stops its timer once no open pull request is shown", async () => {
  const hub = new Hub([{ number: 42 }]);
  const at = watching(hub);
  await at.watch.heard(created("ada"));
  expect(at.clock.waiting).toBe(1);

  hub.pulls = [
    {
      number: 42,
      state: "MERGED",
      mergedAt: "2026-11-20T10:31:00Z",
      closedAt: "2026-11-20T10:31:00Z",
    },
  ];
  await at.watch.refresh();

  expect(at.clock.waiting).toBe(0);
  expect(at.marks.at(-1)).toEqual(["ada", null]);
  expect(at.watch.viewOf("ada").lines.map((one) => one.pull.state)).toEqual([
    "MERGED",
  ]);
});

it("merges with the repository's method, on the head that was read, and reads again", async () => {
  const at = watching(
    new Hub([{ number: 42 }], {
      method: "REBASE",
      allowed: ["squash", "rebase"],
    }),
  );
  await at.watch.heard(created("ada"));

  await at.watch.merge("ada", KEY);
  await at.clock.move(0);

  const merges = at.gh.calls.filter((call) => call.args[1] === "merge");
  expect(merges).toHaveLength(1);
  expect(merges[0]?.args).toEqual([
    "pr",
    "merge",
    URL,
    "--rebase",
    "--match-head-commit",
    "a1b2c3",
  ]);
  expect(merges[0]?.where.host).toBe("github.com");
  expect(at.reads()).toHaveLength(2);
});

it("says what gh said when a merge fails", async () => {
  const hub = new Hub([{ number: 42 }]);
  const at = watching(hub);
  await at.watch.heard(created("ada"));
  hub.other = (call) =>
    call.args[1] === "merge"
      ? failed(
          "GraphQL: Head branch was modified. Review and try the merge again.",
        )
      : undefined;

  await expect(at.watch.merge("ada", KEY)).rejects.toThrow(
    "GraphQL: Head branch was modified. Review and try the merge again.",
  );
});

it("merges nothing that cannot be merged as it is, or that the fold no longer shows", async () => {
  const at = watching(new Hub([{ number: 42 }], { permission: "READ" }));
  await at.watch.heard(created("ada"));

  await expect(at.watch.merge("ada", KEY)).rejects.toThrow(
    "#42 cannot be merged as it is",
  );
  await expect(
    at.watch.merge("ada", pullKey({ ...REPO, number: 99 })),
  ).rejects.toThrow("that pull request is no longer shown");
  await expect(at.watch.merge("grace", KEY)).rejects.toThrow(
    "that pull request is no longer shown",
  );
  expect(at.gh.calls.some((call) => call.args[1] === "merge")).toBe(false);
});

it("shows nothing for the project as a whole", async () => {
  const at = watching(new Hub([{ number: 42 }]));
  await at.watch.heard(created("ada"));

  expect(at.watch.viewOf(null)).toEqual({ lines: [], trouble: null });
});

it("keeps what a session claimed across a restart", async () => {
  const first = watching(new Hub([{ number: 42 }]));
  await first.watch.heard(created("ada"));
  first.watch.stop();

  const store = new Store(first.path);
  const clock = new FakeClock();
  const gh = fakeGh(new Hub([{ number: 42 }]).script);
  const folds: string[] = [];
  const watch = new Watch({
    gh,
    remotes: async () => "",
    store,
    clock,
    out: { fold: (_p, id) => folds.push(id), mark: () => {}, notify: () => {} },
  });
  await watch.start();
  watch.told(session({ id: "ada" }));
  await clock.move(SETTLE_MS);

  expect(folds).toEqual(["ada"]);
  expect(watch.viewOf("ada").lines.map((line) => line.pull.key)).toEqual([KEY]);
});
