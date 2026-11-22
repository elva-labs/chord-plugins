import { PassThrough, Writable } from "node:stream";
import { expect, it } from "vitest";
import { plugin } from "./plugin.js";
import type { ActionContext, Row } from "./index.js";

/**
 * A plugin's two streams, with the lines it wrote read back one at a time
 * and a wait for the ones it has not written yet.
 */
function streams() {
  const input = new PassThrough();
  const all: string[] = [];
  let rest = "";
  let waiting: Array<() => void> = [];
  const output = new Writable({
    write(chunk, _encoding, done) {
      rest += String(chunk);
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      for (const part of parts) {
        if (part !== "") all.push(part);
      }
      const woken = waiting;
      waiting = [];
      for (const wake of woken) wake();
      done();
    },
  });
  return {
    input,
    output,
    all,
    send(message: unknown): void {
      input.write(`${JSON.stringify(message)}\n`);
    },
    async line(index: number): Promise<any> {
      while (all.length <= index) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      return JSON.parse(all[index]!);
    },
  };
}

const check: Row = {
  id: "lint",
  label: "lint",
  detail: "3 of 4",
  state: "ok",
  actions: [{ id: "open", label: "Open" }],
  default: "open",
};

it("greets with its tools and its sections before anything else", async () => {
  const { input, output, line } = streams();
  const p = plugin({ name: "github", version: "0.2.0" });
  p.tool("pr", { description: "The branch's pull request." }, () => "");
  p.tool(
    "checks",
    {
      description: "The branch's checks.",
      inputSchema: {
        type: "object",
        properties: { state: { type: "string" } },
      },
    },
    () => "",
  );
  p.section("pull-request", {
    title: "Pull request",
    actions: [{ id: "refresh", label: "Refresh" }],
    rows: () => [],
  });
  const running = p.run({ input, output });

  expect(await line(0)).toEqual({
    type: "hello",
    name: "github",
    version: "0.2.0",
    tools: [
      {
        name: "pr",
        description: "The branch's pull request.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "checks",
        description: "The branch's checks.",
        inputSchema: {
          type: "object",
          properties: { state: { type: "string" } },
        },
      },
    ],
    sections: [
      {
        id: "pull-request",
        title: "Pull request",
        actions: [{ id: "refresh", label: "Refresh" }],
      },
    ],
    view: null,
  });
  input.end();
  await running;
});

it("answers a tool call with what the handler returned", async () => {
  const { input, output, line, send } = streams();
  const seen: Array<[unknown, unknown]> = [];
  const p = plugin({ name: "github", version: "0.2.0" });
  p.tool("pr", { description: "The pull request." }, (args, context) => {
    seen.push([args, context]);
    return "#42 Retry with jitter";
  });
  p.tool("checks", { description: "The checks." }, () => ({ passed: 3 }));
  const running = p.run({ input, output });
  await line(0);

  send({
    type: "tool",
    id: "c1",
    name: "pr",
    arguments: { state: "open" },
    project: "/srv/orbit-api",
    session: "6f2a",
  });
  expect(await line(1)).toEqual({
    type: "result",
    id: "c1",
    content: "#42 Retry with jitter",
  });
  expect(seen).toEqual([
    [{ state: "open" }, { project: "/srv/orbit-api", session: "6f2a" }],
  ]);

  send({
    type: "tool",
    id: "c2",
    name: "checks",
    arguments: {},
    project: "/srv/orbit-api",
    session: null,
  });
  expect(await line(2)).toEqual({
    type: "result",
    id: "c2",
    content: '{"passed":3}',
  });
  input.end();
  await running;
});

it("answers a tool that threw with the error it threw", async () => {
  const { input, output, line, send } = streams();
  const p = plugin({ name: "github", version: "0.2.0" });
  p.tool("pr", { description: "The pull request." }, () => {
    throw new Error("gh is not logged in");
  });
  const running = p.run({ input, output });
  await line(0);

  send({
    type: "tool",
    id: "c1",
    name: "pr",
    arguments: {},
    project: "/srv/orbit-api",
    session: null,
  });
  expect(await line(1)).toEqual({
    type: "result",
    id: "c1",
    error: "gh is not logged in",
  });
  input.end();
  await running;
});

it("hands an action its row and its input, and sends the section again", async () => {
  const { input, output, line, send } = streams();
  const taken: ActionContext[] = [];
  let detail = "3 of 4";
  const p = plugin({ name: "github", version: "0.2.0" });
  p.section("pull-request", {
    title: "Pull request",
    rows: () => [{ ...check, detail }],
  });
  p.action("pull-request", "open", (call) => {
    taken.push(call);
    detail = "4 of 4";
  });
  const running = p.run({ input, output });
  await line(0);

  send({ type: "hello", app: "0.3.0", projects: ["/srv/orbit-api"] });
  expect(await line(1)).toEqual({
    type: "section",
    id: "pull-request",
    title: "Pull request",
    project: "/srv/orbit-api",
    rows: [{ ...check, detail: "3 of 4" }],
    actions: [],
  });

  send({
    type: "action",
    id: "a7",
    section: "pull-request",
    action: "open",
    row: "lint",
    input: { branch: "main" },
    project: "/srv/orbit-api",
  });
  expect(await line(2)).toEqual({ type: "result", id: "a7" });
  expect(taken).toEqual([
    {
      row: { ...check, detail: "3 of 4" },
      input: { branch: "main" },
      project: "/srv/orbit-api",
      session: null,
      openUrl: expect.any(Function),
    },
  ]);
  expect(await line(3)).toEqual({
    type: "section",
    id: "pull-request",
    title: "Pull request",
    project: "/srv/orbit-api",
    rows: [{ ...check, detail: "4 of 4" }],
    actions: [],
  });
  input.end();
  await running;
});

it("sends a session's own section, and hands its actions the session and its row", async () => {
  const { input, output, line, send } = streams();
  const taken: ActionContext[] = [];
  const asked: Array<{ project: string; session: string | null }> = [];
  const p = plugin({ name: "github", version: "0.2.0" });
  p.section("pull-request", {
    title: "Pull requests",
    actions: ({ session }) =>
      session === null ? [] : [{ id: "refresh", label: "Refresh" }],
    detail: ({ session }) => (session === null ? null : "this session"),
    rows: (context) => {
      asked.push(context);
      return context.session === "6f2a" ? [check] : [];
    },
  });
  p.action("pull-request", "open", (call) => {
    taken.push(call);
  });
  const running = p.run({ input, output });
  await line(0);

  await p.refresh("pull-request", "/srv/orbit-api", "6f2a");
  expect(await line(1)).toEqual({
    type: "section",
    id: "pull-request",
    title: "Pull requests",
    project: "/srv/orbit-api",
    session: "6f2a",
    rows: [check],
    actions: [{ id: "refresh", label: "Refresh" }],
    detail: "this session",
  });

  send({
    type: "action",
    id: "a7",
    section: "pull-request",
    action: "open",
    row: "lint",
    input: {},
    project: "/srv/orbit-api",
    session: "6f2a",
  });
  expect(await line(2)).toEqual({ type: "result", id: "a7" });
  expect(taken[0]?.row).toEqual(check);
  expect(taken[0]?.session).toBe("6f2a");
  expect((await line(3)).session).toBe("6f2a");
  expect(asked).toEqual([
    { project: "/srv/orbit-api", session: "6f2a" },
    { project: "/srv/orbit-api", session: "6f2a" },
  ]);

  send({
    type: "action",
    id: "a8",
    section: "pull-request",
    action: "open",
    row: "lint",
    input: {},
    project: "/srv/orbit-api",
  });
  expect(await line(4)).toEqual({ type: "result", id: "a8" });
  expect(taken[1]?.row).toBeNull();
  expect(taken[1]?.session).toBeNull();
  input.end();
  await running;
});

it("forgets a session's rows once the session has ended", async () => {
  const { input, output, line, send } = streams();
  const taken: ActionContext[] = [];
  const p = plugin({ name: "github", version: "0.2.0" });
  p.section("pull-request", { title: "Pull requests", rows: () => [check] });
  p.action("pull-request", "open", (call) => {
    taken.push(call);
  });
  const running = p.run({ input, output });
  await line(0);
  await p.refresh("pull-request", "/srv/orbit-api", "6f2a");
  await line(1);

  send({
    type: "session",
    event: "ended",
    id: "6f2a",
    project: "/srv/orbit-api",
  });
  send({
    type: "action",
    id: "a7",
    section: "pull-request",
    action: "open",
    row: "lint",
    input: {},
    project: "/srv/orbit-api",
    session: "6f2a",
  });
  expect(await line(2)).toEqual({ type: "result", id: "a7" });
  expect(taken[0]?.row).toBeNull();
  input.end();
  await running;
});

it("opens one web address for an action, before the action's result", async () => {
  const { input, output, line, send, all } = streams();
  const refused: string[] = [];
  const p = plugin({ name: "github", version: "0.2.0" });
  p.section("pull-request", { title: "Pull requests", rows: () => [] });
  p.action("pull-request", "open", ({ openUrl }) => {
    openUrl("https://github.com/acme/orbit-api/pull/42");
    try {
      openUrl("https://github.com/acme/orbit-api/pull/43");
    } catch (error) {
      refused.push(String(error));
    }
  });
  p.action("pull-request", "bad", ({ openUrl }) => {
    openUrl("file:///etc/passwd");
  });
  const running = p.run({ input, output });
  await line(0);

  send({
    type: "action",
    id: "a7",
    section: "pull-request",
    action: "open",
    row: null,
    input: {},
    project: "/srv/orbit-api",
  });
  expect(await line(1)).toEqual({
    type: "open_url",
    project: "/srv/orbit-api",
    action: "a7",
    url: "https://github.com/acme/orbit-api/pull/42",
  });
  expect(await line(2)).toEqual({ type: "result", id: "a7" });
  expect(refused).toHaveLength(1);

  await line(3);
  send({
    type: "action",
    id: "a8",
    section: "pull-request",
    action: "bad",
    row: null,
    input: {},
    project: "/srv/orbit-api",
  });
  const answer = await line(4);
  expect(answer.id).toBe("a8");
  expect(answer.error).toMatch(/not a web address/);
  expect(all.filter((said) => said.includes("open_url"))).toHaveLength(1);
  input.end();
  await running;
});

it("hands a heard command to the command listener", async () => {
  const { input, output, line, send } = streams();
  const heard: unknown[] = [];
  const p = plugin({ name: "github", version: "0.2.0" });
  p.on("command", (event) => heard.push(event));
  const running = p.run({ input, output });
  await line(0);

  const command = {
    type: "command",
    project: "/srv/orbit-api",
    session: "6f2a",
    cwd: "/srv/orbit-api",
    command: "gh pr create --fill",
    ok: true,
    output: "https://github.com/acme/orbit-api/pull/42\n",
    truncated: false,
    withheld: false,
  };
  send(command);
  send({ type: "stop" });
  await running;
  expect(heard).toEqual([command]);
});

it("sends the mark the mark helper stands for, and takes it away", async () => {
  const { input, output, line } = streams();
  const p = plugin({ name: "github", version: "0.2.0" });
  const running = p.run({ input, output });
  await line(0);

  p.mark("/srv/orbit-api", "6f2a", {
    icon: "pull-request",
    count: 2,
    state: "failed",
    label: "2 pull requests, a failing check",
  });
  p.mark("/srv/orbit-api", "6f2a", null);
  expect(await line(1)).toEqual({
    type: "mark",
    project: "/srv/orbit-api",
    session: "6f2a",
    icon: "pull-request",
    count: 2,
    state: "failed",
    label: "2 pull requests, a failing check",
  });
  expect(await line(2)).toEqual({
    type: "mark",
    project: "/srv/orbit-api",
    session: "6f2a",
    icon: null,
  });
  input.end();
  await running;
});

it("answers an action that threw with the error it threw", async () => {
  const { input, output, line, send } = streams();
  const p = plugin({ name: "github", version: "0.2.0" });
  p.section("pull-request", { title: "Pull request", rows: () => [] });
  p.action("pull-request", "open", () => {
    throw new Error("gh is not logged in");
  });
  const running = p.run({ input, output });
  await line(0);

  send({
    type: "action",
    id: "a7",
    section: "pull-request",
    action: "open",
    row: null,
    input: {},
    project: "/srv/orbit-api",
  });
  expect(await line(1)).toEqual({
    type: "result",
    id: "a7",
    error: "gh is not logged in",
  });
  input.end();
  await running;
});

it("asks a header that is a function what it holds, each time the rows go", async () => {
  const { input, output, line, send } = streams();
  let done = false;
  const p = plugin({ name: "github", version: "0.2.0" });
  p.section("pull-request", {
    title: "Pull request",
    actions: ({ project }) =>
      done
        ? [{ id: "clear", label: `Clear ${project}` }]
        : [{ id: "refresh", label: "Refresh" }],
    rows: () => [],
  });
  const running = p.run({ input, output });
  // The greeting asks it too, with no project to speak of.
  const greeting = await line(0);
  expect(greeting.sections).toEqual([
    {
      id: "pull-request",
      title: "Pull request",
      actions: [{ id: "refresh", label: "Refresh" }],
    },
  ]);

  await p.refresh("pull-request", "/srv/orbit-api");
  expect((await line(1)).actions).toEqual([
    { id: "refresh", label: "Refresh" },
  ]);
  done = true;
  await p.refresh("pull-request", "/srv/orbit-api");
  expect((await line(2)).actions).toEqual([
    { id: "clear", label: "Clear /srv/orbit-api" },
  ]);
  input.end();
  await running;
});

it("sends the detail a section says beside its title", async () => {
  const { input, output, line } = streams();
  let said: string | null = "main, 2 ahead";
  const p = plugin({ name: "git", version: "0.1.0" });
  p.section("status", {
    title: "Git",
    detail: () => {
      if (said === null) throw new Error("git is not there");
      return said;
    },
    rows: () => [check],
  });
  const running = p.run({ input, output });
  await line(0);

  await p.refresh("status", "/srv/orbit-api");
  expect(await line(1)).toEqual({
    type: "section",
    id: "status",
    title: "Git",
    project: "/srv/orbit-api",
    rows: [check],
    actions: [],
    detail: "main, 2 ahead",
  });

  // A detail that is nothing, and one that could not be found, are both
  // a section with none, and the rows go all the same.
  said = "";
  await p.refresh("status", "/srv/orbit-api");
  expect(await line(2)).not.toHaveProperty("detail");
  said = null;
  await p.refresh("status", "/srv/orbit-api");
  const third = await line(3);
  expect(third).not.toHaveProperty("detail");
  expect(third.rows).toEqual([check]);
  input.end();
  await running;
});

it("greets with a section that starts folded, and says so when it sends it", async () => {
  const { input, output, line } = streams();
  const p = plugin({ name: "git", version: "0.1.0" });
  p.section("status", { title: "Git", rows: () => [] });
  p.section("branches", { title: "Branches", folded: true, rows: () => [] });
  const running = p.run({ input, output });

  expect((await line(0)).sections).toEqual([
    { id: "status", title: "Git", actions: [] },
    { id: "branches", title: "Branches", actions: [], folded: true },
  ]);

  await p.refresh("status", "/srv/orbit-api");
  expect(await line(1)).not.toHaveProperty("folded");
  await p.refresh("branches", "/srv/orbit-api");
  expect((await line(2)).folded).toBe(true);
  input.end();
  await running;
});

it("sends every section when a project opens, and forgets it when it closes", async () => {
  const { input, output, line, send, all } = streams();
  const opened: string[] = [];
  const p = plugin({ name: "github", version: "0.2.0" });
  p.section("pull-request", { title: "Pull request", rows: () => [check] });
  p.section("releases", { title: "Releases", rows: () => [] });
  p.on("project", (event) => opened.push(`${event.event} ${event.path}`));
  const running = p.run({ input, output });
  await line(0);

  send({ type: "hello", app: "0.3.0", projects: [] });
  send({ type: "project", event: "opened", path: "/srv/orbit-api" });
  const first = await line(1);
  const second = await line(2);
  expect([first.id, second.id].sort()).toEqual(["pull-request", "releases"]);
  expect(first.project).toBe("/srv/orbit-api");
  expect(second.project).toBe("/srv/orbit-api");

  send({ type: "project", event: "closed", path: "/srv/orbit-api" });
  send({
    type: "tool",
    id: "c1",
    name: "nothing",
    arguments: {},
    project: "/srv/orbit-api",
    session: null,
  });
  await line(3);
  expect(all).toHaveLength(4);
  expect(opened).toEqual(["opened /srv/orbit-api", "closed /srv/orbit-api"]);
  input.end();
  await running;
});

it("sends the lines the open, diff, present and notify helpers stand for", async () => {
  const { input, output, line } = streams();
  const p = plugin({ name: "github", version: "0.2.0" });
  const running = p.run({ input, output });
  await line(0);

  p.open("/srv/orbit-api", {
    path: "src/main.rs",
    from: 3,
    to: 5,
    note: "here",
  });
  p.diff("/srv/orbit-api", { path: "src/main.rs" });
  p.present("/srv/orbit-api", { files: ["shot.png"], caption: "The graph" });
  p.notify("/srv/orbit-api", "needs a key", "6f2a");

  expect(await line(1)).toEqual({
    type: "open",
    project: "/srv/orbit-api",
    path: "src/main.rs",
    from: 3,
    to: 5,
    note: "here",
  });
  expect(await line(2)).toEqual({
    type: "diff",
    project: "/srv/orbit-api",
    path: "src/main.rs",
  });
  expect(await line(3)).toEqual({
    type: "present",
    project: "/srv/orbit-api",
    files: ["shot.png"],
    caption: "The graph",
  });
  expect(await line(4)).toEqual({
    type: "notify",
    project: "/srv/orbit-api",
    text: "needs a key",
    session: "6f2a",
  });
  input.end();
  await running;
});

it("greets with the room its view asks for", async () => {
  const { input, output, line } = streams();
  const p = plugin({ name: "git", version: "0.1.0", view: "full" });
  const running = p.run({ input, output });

  expect((await line(0)).view).toEqual({ width: "full" });
  input.end();
  await running;
});

it("sends the lines the view and viewData helpers stand for", async () => {
  const { input, output, line } = streams();
  const p = plugin({ name: "git", version: "0.1.0", view: "full" });
  const running = p.run({ input, output });
  await line(0);

  p.view("/srv/orbit-api", { html: "<h1>Graph</h1>" });
  p.view("/srv/orbit-api", { path: "page.html", open: true });
  p.viewData("/srv/orbit-api", { commit: "1a2b3c" });

  expect(await line(1)).toEqual({
    type: "view",
    project: "/srv/orbit-api",
    html: "<h1>Graph</h1>",
  });
  expect(await line(2)).toEqual({
    type: "view",
    project: "/srv/orbit-api",
    path: "page.html",
    open: true,
  });
  expect(await line(3)).toEqual({
    type: "view_data",
    project: "/srv/orbit-api",
    data: { commit: "1a2b3c" },
  });
  input.end();
  await running;
});

it("hands what the page sent to the view_message listener", async () => {
  const { input, output, line, send } = streams();
  const heard: unknown[] = [];
  const p = plugin({ name: "git", version: "0.1.0", view: "full" });
  p.on("view_message", (event) => {
    heard.push([event.project, event.payload]);
    p.viewData(event.project, { got: event.payload });
  });
  const running = p.run({ input, output });
  await line(0);

  send({
    type: "view_message",
    project: "/srv/orbit-api",
    payload: { commit: "1a2b3c" },
  });
  expect(await line(1)).toEqual({
    type: "view_data",
    project: "/srv/orbit-api",
    data: { got: { commit: "1a2b3c" } },
  });
  expect(heard).toEqual([["/srv/orbit-api", { commit: "1a2b3c" }]]);
  input.end();
  await running;
});

it("answers a page's click with a start, a send and a web address", async () => {
  const { input, output, line, send } = streams();
  const p = plugin({ name: "github", version: "0.3.0", view: "wide" });
  p.on("view_message", (event) => {
    if (!event.id) return;
    p.start(event.project, event.id, {
      prompt: "Review pull request #42.",
      name: "Review: Retry with jitter",
      ref: "pr/42",
      worktree: true,
      purpose: "review",
      agent: "Reviewer",
    });
    p.send(event.id, "6f2a", "Review #42 again.");
    p.openUrl(event.project, event.id, "https://github.com/orbit/api/pull/42");
  });
  const running = p.run({ input, output });
  await line(0);

  send({
    type: "view_message",
    project: "/srv/orbit-api",
    payload: { start: "pr/42" },
    id: "9d1e",
  });
  expect(await line(1)).toEqual({
    type: "start",
    answers: "9d1e",
    project: "/srv/orbit-api",
    prompt: "Review pull request #42.",
    name: "Review: Retry with jitter",
    ref: "pr/42",
    worktree: true,
    purpose: "review",
    agent: "Reviewer",
  });
  expect(await line(2)).toEqual({
    type: "send",
    answers: "9d1e",
    session: "6f2a",
    text: "Review #42 again.",
  });
  expect(await line(3)).toEqual({
    type: "open_url",
    project: "/srv/orbit-api",
    answers: "9d1e",
    url: "https://github.com/orbit/api/pull/42",
  });
  input.end();
  await running;
});

it("hands what came of a send to the sent listener", async () => {
  const { input, output, line, send } = streams();
  const heard: unknown[] = [];
  const p = plugin({ name: "github", version: "0.3.0" });
  p.on("sent", (event) => {
    heard.push(event);
    p.notify("/srv/orbit-api", event.outcome);
  });
  const running = p.run({ input, output });
  await line(0);

  send({ type: "sent", answers: "9d1e", session: "6f2a", outcome: "gone" });
  expect(await line(1)).toEqual({
    type: "notify",
    project: "/srv/orbit-api",
    text: "gone",
  });
  expect(heard).toEqual([
    { type: "sent", answers: "9d1e", session: "6f2a", outcome: "gone" },
  ]);
  input.end();
  await running;
});

it("says the plugin's own notification with the target its page is handed", async () => {
  const { input, output, line } = streams();
  const p = plugin({ name: "github", version: "0.3.0", view: "wide" });
  const running = p.run({ input, output });
  await line(0);

  p.notify("/srv/orbit-api", "A review was asked of you on #42", null, "pr/42");
  expect(await line(1)).toEqual({
    type: "notify",
    project: "/srv/orbit-api",
    text: "A review was asked of you on #42",
    target: "pr/42",
  });
  expect(() => p.notify("/srv/orbit-api", "x", null, "t".repeat(257))).toThrow(
    /256 bytes/,
  );
  input.end();
  await running;
});

it("refuses a start, a send or a web address the app would drop", () => {
  const p = plugin({ name: "github", version: "0.3.0" });
  expect(() =>
    p.start("/srv/orbit-api", "9d1e", { prompt: "/review" }),
  ).toThrow(/begin with/);
  expect(() =>
    p.start("/srv/orbit-api", "9d1e", { prompt: "\u200b!rm -rf ." }),
  ).toThrow(/begin with/);
  expect(() =>
    p.start("/srv/orbit-api", "9d1e", { prompt: "x".repeat(8 * 1024 + 1) }),
  ).toThrow(/8192 bytes/);
  expect(() =>
    p.start("/srv/orbit-api", "9d1e", {
      prompt: "Review.",
      ref: "r".repeat(257),
    }),
  ).toThrow(/ref/);
  expect(() => p.send("9d1e", "6f2a", "!ls")).toThrow(/begin with/);
  expect(() => p.send("9d1e", "6f2a", "x".repeat(4 * 1024 + 1))).toThrow(
    /4096 bytes/,
  );
  expect(() =>
    p.openUrl("/srv/orbit-api", "9d1e", "javascript:alert(1)"),
  ).toThrow(/web address/);
});

it("ends the loop when it is told to stop", async () => {
  const { input, output, line, send } = streams();
  const stopped: string[] = [];
  const p = plugin({ name: "github", version: "0.2.0" });
  p.on("stop", () => stopped.push("stop"));
  const running = p.run({ input, output });
  await line(0);

  send({ type: "stop" });
  await running;
  expect(stopped).toEqual(["stop"]);
});

it("leaves a line it cannot read and a kind it does not know alone", async () => {
  const { input, output, line, send, all } = streams();
  const p = plugin({ name: "github", version: "0.2.0" });
  p.tool("pr", { description: "The pull request." }, () => "#42");
  const running = p.run({ input, output });
  await line(0);

  input.write("{not json at all\n");
  send({ type: "view", message: "hello" });
  send({
    type: "tool",
    id: "c1",
    name: "pr",
    arguments: {},
    project: "/srv/orbit-api",
    session: null,
  });
  expect(await line(1)).toEqual({ type: "result", id: "c1", content: "#42" });
  expect(all).toHaveLength(2);
  input.end();
  await running;
});

it("refuses a name that is not a plain identifier", () => {
  const p = plugin({ name: "github", version: "0.2.0" });
  expect(() => p.tool("Pull Request", { description: "" }, () => "")).toThrow(
    /lowercase/,
  );
  expect(() => p.section("2releases", { title: "", rows: () => [] })).toThrow(
    /lowercase/,
  );
  expect(() => p.action("pull-request", "open!", () => {})).toThrow(
    /lowercase/,
  );
  expect(() => plugin({ name: "", version: "0.2.0" })).toThrow(/lowercase/);
});

it("refuses a view that is neither wide nor full", () => {
  expect(() =>
    plugin({
      name: "git",
      version: "0.1.0",
      view: "huge" as "wide",
    }),
  ).toThrow(/wide or full/);
});
