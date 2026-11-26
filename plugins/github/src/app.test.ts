import type { CommandEvent, SessionEvent } from "@elva-labs/workbench-plugin";
import { expect, it } from "vitest";
import {
  askRows,
  confirmed,
  detailOf,
  factsOf,
  headerOf,
  heardOf,
  keyOfReviewRow,
  keyOfRow,
  markOf,
  MERGE,
  OPEN,
  REFRESH,
  reviewRows,
  rowId,
  rowsOf,
  sessionOf,
  timeOf,
  VIEW,
  type Line,
  type View,
} from "./app.js";
import { pull } from "./fake.test-helper.js";
import type { Check, Pull } from "./pulls.js";
import type { Asked } from "./requests.js";
import {
  readyToMerge,
  stateOf,
  summaryOf,
  tallyOf,
  worst,
} from "./standing.js";

const NOW = Date.parse("2026-11-20T10:30:00Z");

const pass = (name: string): Check => ({ name, bucket: "pass" });
const fail = (name: string): Check => ({ name, bucket: "fail" });
const running = (name: string): Check => ({ name, bucket: "pending" });
const skipped = (name: string): Check => ({ name, bucket: "skipping" });

function review(who: string, state: string, at = NOW): Pull["reviews"][number] {
  return { login: who.toLowerCase(), who, state, at };
}

function line(over: Partial<Pull> = {}, more: Partial<Line> = {}): Line {
  return { pull: pull(over), merge: null, ...more };
}

function view(lines: Line[], trouble: View["trouble"] = null): View {
  return { lines, trouble, need: null };
}

function needing(need: View["need"]): View {
  return { lines: [], trouble: null, need };
}

it("takes the worst of the checks and reviews as a pull request's state", () => {
  expect(worst([])).toBeNull();
  expect(worst([null, "ok", "busy"])).toBe("busy");
  expect(worst(["waiting", "busy", "ok"])).toBe("waiting");
  expect(worst(["failed", "waiting"])).toBe("failed");

  expect(stateOf(pull())).toBe("ok");
  expect(stateOf(pull({ checks: [pass("test"), running("e2e")] }))).toBe(
    "busy",
  );
  expect(stateOf(pull({ checks: [running("e2e")], asked: ["Grace"] }))).toBe(
    "waiting",
  );
  expect(stateOf(pull({ decision: "REVIEW_REQUIRED" }))).toBe("waiting");
  expect(stateOf(pull({ checks: [fail("lint")], decision: "APPROVED" }))).toBe(
    "failed",
  );
  expect(
    stateOf(pull({ reviews: [review("Grace", "CHANGES_REQUESTED")] })),
  ).toBe("failed");
  expect(stateOf(pull({ state: "MERGED" }))).toBe("ok");
  expect(stateOf(pull({ state: "CLOSED" }))).toBeNull();
});

it("leaves conflicts and drafts out of the state, and says them in the summary", () => {
  const conflicting = pull({ mergeable: "CONFLICTING", mergeState: "DIRTY" });
  const draft = pull({ draft: true });

  expect(stateOf(conflicting)).toBe("ok");
  expect(summaryOf(conflicting)).toBe("conflicts");
  expect(stateOf(draft)).toBe("ok");
  expect(summaryOf(draft)).toBe("draft");
});

it("sums up what a pull request waits on, the most pressing first", () => {
  expect(summaryOf(pull())).toBe("ready to merge");
  expect(summaryOf(pull({ checks: [fail("lint")] }))).toBe("a check failed");
  expect(summaryOf(pull({ checks: [fail("lint"), fail("test")] }))).toBe(
    "2 checks failed",
  );
  expect(summaryOf(pull({ decision: "CHANGES_REQUESTED" }))).toBe(
    "changes requested",
  );
  expect(summaryOf(pull({ checks: [running("e2e")] }))).toBe("checks running");
  expect(summaryOf(pull({ asked: ["Grace"] }))).toBe("waiting on review");
  expect(summaryOf(pull({ mergeState: "BEHIND" }))).toBe("behind main");
  expect(summaryOf(pull({ mergeState: "BLOCKED" }))).toBe("blocked");
  expect(summaryOf(pull({ mergeable: "UNKNOWN", mergeState: "UNKNOWN" }))).toBe(
    "open",
  );
  expect(summaryOf(pull({ state: "MERGED" }))).toBe("merged");
  expect(summaryOf(pull({ state: "CLOSED" }))).toBe("closed");
});

it("calls a pull request ready to merge only when GitHub would merge it as it is", () => {
  expect(readyToMerge(pull())).toBe(true);
  expect(readyToMerge(pull({ mergeState: "UNSTABLE" }))).toBe(true);
  expect(readyToMerge(pull({ mergeState: "HAS_HOOKS" }))).toBe(true);
  expect(readyToMerge(pull({ draft: true }))).toBe(false);
  expect(readyToMerge(pull({ mergeable: "CONFLICTING" }))).toBe(false);
  expect(readyToMerge(pull({ mergeable: "UNKNOWN" }))).toBe(false);
  expect(readyToMerge(pull({ mergeState: "BLOCKED" }))).toBe(false);
  expect(readyToMerge(pull({ mergeState: "BEHIND" }))).toBe(false);
  expect(readyToMerge(pull({ state: "MERGED" }))).toBe(false);
});

it("draws a row for each pull request, with its number, title, branch and state", () => {
  const rows = rowsOf(
    view([
      line({ checks: [fail("CI / lint"), pass("test")] }),
      line({ number: 7, title: "Bump the SDK", head: "bump-sdk", draft: true }),
    ]),
  );

  expect(rows).toEqual([
    {
      id: "pr:github.com/orbit/api#42",
      label: "#42 Retry the upload",
      detail: "retry-upload · a check failed",
      state: "failed",
      actions: [{ id: OPEN, label: "Open on GitHub" }],
      default: OPEN,
      facts: [
        { label: "CI / lint", text: "failed · 1 passed", state: "failed" },
        { label: "No conflicts", text: "ready", state: "ok" },
      ],
    },
    {
      id: "pr:github.com/orbit/api#7",
      label: "#7 Bump the SDK",
      detail: "bump-sdk · draft",
      state: "ok",
      actions: [{ id: OPEN, label: "Open on GitHub" }],
      default: OPEN,
      facts: [
        { label: "No conflicts", text: null, state: null },
        { label: "Draft" },
      ],
    },
  ]);
});

it("names the repository on each row when the rows come from more than one", () => {
  const rows = rowsOf(view([line(), line({ name: "web", number: 3 })]));

  expect(rows.map((row) => row.detail)).toEqual([
    "api · retry-upload · ready to merge",
    "web · retry-upload · ready to merge",
  ]);
});

it("offers Merge only where it can merge, and asks first, naming the method", () => {
  const [row] = rowsOf(view([line({}, { merge: "squash" })]));

  expect(row?.default).toBe(OPEN);
  expect(row?.actions).toEqual([
    { id: OPEN, label: "Open on GitHub" },
    {
      id: MERGE,
      label: "Merge",
      input: [
        {
          id: "sure",
          label: "Merge #42 into main, squashed?",
          kind: "choice",
          options: [
            { id: "no", label: "No" },
            { id: "yes", label: "Yes, merge it" },
          ],
        },
      ],
    },
  ]);
  expect(confirmed({ sure: "yes" })).toBe(true);
  expect(confirmed({ sure: "no" })).toBe(false);
  expect(confirmed({})).toBe(false);
});

it("says how the checks stand: failed naming the check, running, or passed", () => {
  const checks = (...given: Check[]) => factsOf(pull({ checks: given }))[0];

  expect(checks(fail("lint"))).toEqual({
    label: "lint",
    text: "failed",
    state: "failed",
  });
  expect(
    checks(
      fail("lint"),
      fail("test"),
      fail("e2e"),
      pass("build"),
      running("deploy"),
    ),
  ).toEqual({
    label: "lint, test and 1 more",
    text: "failed · 1 passed, 1 running",
    state: "failed",
  });
  expect(checks(running("e2e"), pass("test"), pass("lint"))).toEqual({
    label: "1 check running",
    text: "2 passed",
    state: "busy",
  });
  expect(checks(running("e2e"), running("test"))).toEqual({
    label: "2 checks running",
    text: null,
    state: "busy",
  });
  expect(checks(pass("test"), skipped("deploy"))).toEqual({
    label: "1 check passed",
    text: "1 skipped",
    state: "ok",
  });
  expect(checks(skipped("deploy"), skipped("docs"))).toEqual({
    label: "2 checks skipped",
    state: "ok",
  });
});

it("says how the reviews stand: changes requested, approved, or asked of whom", () => {
  const reviews = (over: Partial<Pull>) =>
    factsOf(pull({ mergeable: "UNKNOWN", ...over }));

  expect(
    reviews({
      reviews: [
        review("Grace", "CHANGES_REQUESTED"),
        review("Linus", "APPROVED"),
      ],
    }),
  ).toEqual([
    { label: "Changes requested", text: "by Grace", state: "failed" },
  ]);
  expect(reviews({ decision: "CHANGES_REQUESTED" })).toEqual([
    { label: "Changes requested", text: null, state: "failed" },
  ]);
  expect(reviews({ asked: ["Linus", "Platform"] })).toEqual([
    { label: "Review asked", text: "of Linus and Platform", state: "waiting" },
  ]);
  expect(reviews({ asked: ["A", "B", "C", "D"] })).toEqual([
    { label: "Review asked", text: "of A, B and 2 more", state: "waiting" },
  ]);
  expect(reviews({ decision: "REVIEW_REQUIRED" })).toEqual([
    { label: "Review required", state: "waiting" },
  ]);
  expect(
    reviews({
      reviews: [review("Grace", "APPROVED"), review("Linus", "APPROVED")],
    }),
  ).toEqual([{ label: "Approved", text: "by Grace and Linus", state: "ok" }]);
  expect(reviews({ decision: "APPROVED" })).toEqual([
    { label: "Approved", text: null, state: "ok" },
  ]);
  expect(reviews({ reviews: [review("Grace", "COMMENTED")] })).toEqual([]);
});

it("says whether it merges cleanly, conflicts, or is a draft", () => {
  expect(factsOf(pull())).toEqual([
    { label: "No conflicts", text: "ready", state: "ok" },
  ]);
  expect(factsOf(pull({ mergeState: "BEHIND" }))).toEqual([
    { label: "No conflicts", text: "behind main", state: null },
  ]);
  expect(factsOf(pull({ mergeState: "BLOCKED" }))).toEqual([
    {
      label: "No conflicts",
      text: "blocked by the branch's rules",
      state: null,
    },
  ]);
  expect(factsOf(pull({ mergeable: "CONFLICTING", draft: true }))).toEqual([
    { label: "Conflicts", text: "with main", state: "failed" },
    { label: "Draft" },
  ]);
  expect(factsOf(pull({ mergeable: "UNKNOWN" }))).toEqual([]);
});

it("says a pull request was merged or closed, and nothing of merging after", () => {
  expect(factsOf(pull({ state: "MERGED", checks: [pass("test")] }))).toEqual([
    { label: "Merged", text: "into main", state: "ok" },
    { label: "1 check passed", text: null, state: "ok" },
  ]);
  expect(factsOf(pull({ state: "CLOSED" }))).toEqual([
    { label: "Closed", text: "without merging" },
  ]);
  const [row] = rowsOf(view([line({ state: "CLOSED" })]));
  expect(row).not.toHaveProperty("state");
});

it("marks a session's row with its open pull requests, tinted by the worst", () => {
  expect(tallyOf([])).toBeNull();
  expect(tallyOf([pull({ state: "MERGED" })])).toBeNull();
  expect(tallyOf([pull()])).toEqual({
    count: 1,
    state: "ok",
    label: "1 pull request, all well",
  });
  expect(
    tallyOf([
      pull(),
      pull({ number: 7, checks: [running("e2e")] }),
      pull({ number: 8, state: "MERGED", checks: [fail("lint")] }),
    ]),
  ).toEqual({
    count: 2,
    state: "busy",
    label: "2 pull requests, checks running",
  });
  expect(tallyOf([pull({ asked: ["Grace"] })])?.label).toBe(
    "1 pull request, waiting on review",
  );
  expect(tallyOf([pull({ decision: "CHANGES_REQUESTED" })])?.label).toBe(
    "1 pull request, changes requested",
  );
  expect(
    tallyOf([
      pull({ decision: "CHANGES_REQUESTED" }),
      pull({ checks: [fail("x")] }),
    ])?.label,
  ).toBe("2 pull requests, a failing check");

  expect(markOf(null)).toBeNull();
  expect(
    markOf({
      count: 2,
      state: "failed",
      label: "2 pull requests, a failing check",
    }),
  ).toEqual({
    icon: "pull-request",
    count: 2,
    state: "failed",
    label: "2 pull requests, a failing check",
  });
});

it("heads the fold with Refresh, or Try again while something is in the way", () => {
  expect(headerOf(view([]))).toEqual([]);
  expect(headerOf(view([line()]))).toEqual([{ id: REFRESH, label: "Refresh" }]);
  expect(headerOf(view([], { kind: "missing" }))).toEqual([
    { id: REFRESH, label: "Try again" },
  ]);
});

it("says nothing beside the title, unless something is in the way: then what, and the command to run", () => {
  expect(detailOf(view([]))).toBeNull();
  expect(detailOf(view([line()]))).toBeNull();
  expect(detailOf(view([], { kind: "missing" }))).toBe(
    "gh is not on the PATH. Install the GitHub CLI (cli.github.com), then Try again.",
  );
  expect(
    detailOf(view([], { kind: "signed-out", host: "ghe.corp.example" })),
  ).toBe(
    "Not signed in to ghe.corp.example. Run gh auth login --hostname ghe.corp.example in a terminal, then Try again.",
  );
  expect(
    detailOf(
      view([], { kind: "limited", host: "github.com", until: NOW + 90_000 }),
    ),
  ).toBe(`Rate limited on github.com until ${timeOf(NOW + 90_000)}.`);
  expect(
    detailOf(view([], { kind: "limited", host: "github.com", until: null })),
  ).toBe("Rate limited on github.com, trying again in a few minutes.");
  expect(
    detailOf(
      view([], { kind: "failed", host: "github.com", text: "Bad credentials" }),
    ),
  ).toBe("gh failed on github.com: Bad credentials");
});

it("writes a time of day as hours and minutes", () => {
  const at = new Date(2026, 10, 20, 9, 5).getTime();

  expect(timeOf(at)).toBe("09:05");
});

it("finds a pull request's key in its row's id, and nothing in another row's", () => {
  expect(keyOfRow(rowId("github.com/orbit/api#42"))).toBe(
    "github.com/orbit/api#42",
  );
  expect(keyOfRow("refresh")).toBeNull();
  expect(keyOfRow(undefined)).toBeNull();
});

it("reads a session as the app tells it", () => {
  const told = (over: Partial<SessionEvent>) =>
    sessionOf({
      type: "session",
      event: "started",
      id: "s1",
      project: "/srv/orbit",
      ...over,
    } as SessionEvent);

  expect(told({})).toEqual({
    ended: false,
    ref: null,
    session: {
      id: "s1",
      project: "/srv/orbit",
      cwd: "/srv/orbit",
      worktree: false,
      branch: null,
    },
  });
  expect(
    told({
      event: "state",
      cwd: "/srv/orbit/.worktrees/retry",
      worktree: true,
      branch: "retry-upload",
      startedBy: "lead",
    }),
  ).toEqual({
    ended: false,
    ref: null,
    session: {
      id: "s1",
      project: "/srv/orbit",
      cwd: "/srv/orbit/.worktrees/retry",
      worktree: true,
      branch: "retry-upload",
    },
  });
  expect(told({ branch: "retry-upload" })?.session.branch).toBeNull();
  expect(told({ event: "ended" })?.ended).toBe(true);
  expect(told({ ref: "review:github.com/orbit/api#42" })?.ref).toBe(
    "review:github.com/orbit/api#42",
  );
  expect(told({ ref: "" })?.ref).toBeNull();
  expect(told({ id: "" })).toBeNull();
});

it("reads a heard command, and output the app held back as none", () => {
  const event = {
    type: "command",
    project: "/srv/orbit",
    session: "s1",
    cwd: "/srv/orbit/api",
    command: "gh pr create --fill",
    ok: true,
    output: "https://github.com/orbit/api/pull/42\n",
    truncated: false,
    withheld: false,
  } as CommandEvent;

  expect(heardOf(event)).toEqual({
    project: "/srv/orbit",
    session: "s1",
    cwd: "/srv/orbit/api",
    command: "gh pr create --fill",
    ok: true,
    output: "https://github.com/orbit/api/pull/42\n",
  });
  expect(heardOf({ ...event, output: null, withheld: true }).output).toBeNull();
  expect(heardOf({ ...event, output: "", withheld: true }).output).toBeNull();
  expect(heardOf({ ...event, cwd: "" }).cwd).toBe("/srv/orbit");
});

function ask(number: number, author = "Grace Hopper"): Asked {
  return {
    host: "github.com",
    owner: "orbit",
    name: "api",
    number,
    key: `github.com/orbit/api#${number}`,
    title: "Retry the upload",
    url: `https://github.com/orbit/api/pull/${number}`,
    author,
    at: NOW,
    draft: false,
    fork: false,
    checks: [],
    reviewed: null,
  };
}

it("ends a fold with how many reviews are asked of you, by whom, and View", () => {
  expect(askRows([])).toEqual([]);
  expect(askRows([ask(7)])).toEqual([
    {
      id: "asks",
      label: "1 review asked of you",
      detail: "Grace Hopper",
      state: "waiting",
      actions: [{ id: VIEW, label: "View" }],
      default: VIEW,
    },
  ]);
  const rows = askRows([ask(7), ask(8), ask(9, "Alan Turing")]);
  expect(rows[0]?.label).toBe("3 reviews asked of you");
  expect(rows[0]?.detail).toBe("Grace Hopper and Alan Turing");
  expect(keyOfRow(rows[0]?.id)).toBeNull();
  expect(keyOfReviewRow(rows[0]?.id)).toBeNull();
});

it("gives a review session a row for the pull request it reviews, which opens it", () => {
  const rows = reviewRows([ask(7)]);
  expect(rows).toEqual([
    {
      id: "review:github.com/orbit/api#7",
      label: "#7 Retry the upload",
      detail: "orbit/api · by Grace Hopper",
      actions: [{ id: OPEN, label: "Open on GitHub" }],
      default: OPEN,
    },
  ]);
  expect(keyOfReviewRow(rows[0]?.id)).toBe("github.com/orbit/api#7");
  expect(keyOfRow(rows[0]?.id)).toBeNull();
  expect(keyOfReviewRow(rowId("github.com/orbit/api#7"))).toBeNull();
  expect(keyOfReviewRow(undefined)).toBeNull();
});

it("says what gh is missing on the project's fold, with the install for the platform and a way to check again", () => {
  const missing = needing("missing");
  expect(detailOf(missing)).toBe(
    "Needs the GitHub CLI on this machine, signed in.",
  );
  expect(headerOf(missing)).toEqual([{ id: REFRESH, label: "Check again" }]);
  expect(rowsOf(missing, "darwin")).toEqual([
    {
      id: "need:gh",
      label: "GitHub CLI",
      detail: "Not found",
      state: "waiting",
      actions: [{ id: "guide", label: "Install guide" }],
      default: "guide",
      facts: [
        { label: "Install", text: "brew install gh" },
        { label: "Guide", text: "cli.github.com" },
      ],
    },
    {
      id: "need:sign-in",
      label: "Signed in to GitHub",
      detail: "After the install",
      facts: [{ label: "Run", text: "gh auth login" }],
    },
  ]);
  expect(rowsOf(missing, "win32")[0]?.facts?.[0]?.text).toBe(
    "winget install --id GitHub.cli",
  );
  expect(rowsOf(missing, "linux")[0]?.facts?.[0]?.text).toBe(
    "see the install guide",
  );
});

it("says gh is not signed in with the command to run, and nothing when it has what it needs", () => {
  const out = needing("signed-out");
  expect(detailOf(out)).toBe("Needs a sign-in to GitHub.");
  expect(headerOf(out)).toEqual([{ id: REFRESH, label: "Check again" }]);
  expect(rowsOf(out)).toEqual([
    {
      id: "need:sign-in",
      label: "Signed in to GitHub",
      detail: "Not signed in",
      state: "waiting",
      facts: [{ label: "Run", text: "gh auth login" }],
    },
  ]);
  const fine = needing(null);
  expect(rowsOf(fine)).toEqual([]);
  expect(detailOf(fine)).toBeNull();
  expect(headerOf(fine)).toEqual([]);
});
