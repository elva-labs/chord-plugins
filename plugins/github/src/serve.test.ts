import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, expect, it } from "vitest";
import { answer, node } from "./fake.test-helper.js";
import { serve } from "./serve.js";
import { HOME } from "./store.js";

const PROJECT = "/srv/orbit";
const URL = "https://github.com/orbit/api/pull/42";

let dir: string;
const path = process.env.PATH;
const home = process.env[HOME];

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "github-serve-")));
  process.env.PATH = `${dir}:${path}`;
  process.env[HOME] = dir;
  // A gh that answers GitHub's questions from answer.json, says it is
  // signed in to github.com, and writes down each call that reaches out.
  await writeFile(
    join(dir, "gh"),
    [
      "#!/bin/sh",
      'case "$1 $2" in',
      `  "api graphql") echo "api $GH_HOST" >> "${dir}/calls"; cat "${dir}/answer.json" ;;`,
      `  "auth status") echo '{"hosts":{"github.com":[]}}' ;;`,
      `  "pr merge") echo "merge $GH_HOST $*" >> "${dir}/calls" ;;`,
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
});

afterEach(async () => {
  process.env.PATH = path;
  if (home === undefined) delete process.env[HOME];
  else process.env[HOME] = home;
  await rm(dir, { recursive: true, force: true });
});

/** What the app would hold: the plugin's input to write to, and every
    line it wrote, to wait on. */
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
      for (const part of parts) if (part !== "") all.push(part);
      const woken = waiting;
      waiting = [];
      for (const wake of woken) wake();
      done();
    },
  });
  return {
    input,
    output,
    send(message: unknown): void {
      input.write(`${JSON.stringify(message)}\n`);
    },
    /** The first line from `from` on that passes, once it is written. */
    async find(
      test: (line: any) => boolean,
      from = 0,
    ): Promise<{ line: any; at: number }> {
      for (let at = from; ; at += 1) {
        while (all.length <= at) {
          await new Promise<void>((wake) => waiting.push(wake));
        }
        const line = JSON.parse(all[at]!);
        if (test(line)) return { line, at };
      }
    },
  };
}

async function answers(checks: { name: string; conclusion?: string }[]) {
  const failing = checks.some((one) => one.conclusion === "FAILURE");
  await writeFile(
    join(dir, "answer.json"),
    answer({
      numbers: [
        node({ number: 42, checks, rollup: failing ? "FAILURE" : "SUCCESS" }),
      ],
    }),
  );
}

async function calls(): Promise<string[]> {
  return (await readFile(join(dir, "calls"), "utf8")).trim().split("\n");
}

it("shows, marks, opens, merges and tells of the pull request a session made, over the app's streams and the gh on the PATH", async () => {
  await answers([{ name: "lint" }]);
  const app = streams();
  const done = serve({ input: app.input, output: app.output });

  const hello = await app.find(() => true);
  expect(hello.line).toMatchObject({ type: "hello", name: "github" });

  app.send({
    type: "session",
    event: "started",
    id: "s1",
    project: PROJECT,
    cwd: dir,
    worktree: false,
  });
  app.send({
    type: "command",
    project: PROJECT,
    session: "s1",
    cwd: dir,
    command: "gh pr create --fill",
    ok: true,
    output: `Creating pull request for retry-upload into main in orbit/api\n\n${URL}\n`,
    truncated: false,
    withheld: false,
  });

  const shown = await app.find(
    (line) =>
      line.type === "section" &&
      line.session === "s1" &&
      line.rows.length === 1,
  );
  expect(shown.line).toMatchObject({
    id: "pulls",
    title: "Pull requests",
    project: PROJECT,
    rows: [{ id: "pr:github.com/orbit/api#42" }],
    actions: [{ id: "refresh" }],
  });
  expect(shown.line.detail).toBeUndefined();
  const marked = await app.find((line) => line.type === "mark");
  expect(marked.line).toEqual({
    type: "mark",
    project: PROJECT,
    session: "s1",
    icon: "pull-request",
    count: 1,
    state: "ok",
    label: "1 pull request, all well",
  });

  const action = (id: string, name: string, input = {}) => ({
    type: "action",
    id,
    section: "pulls",
    action: name,
    row: "pr:github.com/orbit/api#42",
    input,
    project: PROJECT,
    session: "s1",
  });

  app.send(action("a1", "open"));
  const opened = await app.find((line) => line.type === "open_url");
  expect(opened.line).toEqual({
    type: "open_url",
    project: PROJECT,
    action: "a1",
    url: URL,
  });
  const result = await app.find((line) => line.type === "result", opened.at);
  expect(result.line).toEqual({ type: "result", id: "a1" });

  app.send(action("a2", "merge", { sure: "yes" }));
  const merged = await app.find(
    (line) => line.type === "result" && line.id === "a2",
  );
  expect(merged.line).toEqual({ type: "result", id: "a2" });
  expect(await calls()).toContain(
    `merge github.com pr merge ${URL} --squash --match-head-commit a1b2c3`,
  );

  await answers([{ name: "lint", conclusion: "FAILURE" }]);
  app.send({ ...action("a3", "refresh"), row: null });
  const told = await app.find((line) => line.type === "notify");
  expect(told.line).toEqual({
    type: "notify",
    project: PROJECT,
    text: "#42 check failed: lint",
    session: "s1",
  });
  expect(await calls()).toContain("api github.com");

  app.send({ type: "stop" });
  await done;
});

it("says on the project's own fold that gh is signed out, and again when checked again", async () => {
  await writeFile(
    join(dir, "gh"),
    [
      "#!/bin/sh",
      `if [ -f "${dir}/in" ]; then echo '{"hosts":{"github.com":[]}}'; else echo '{"hosts":{}}'; fi`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const app = streams();
  const done = serve({ input: app.input, output: app.output });
  await app.find((line) => line.type === "hello");
  app.send({ type: "hello", app: "1", projects: [PROJECT] });

  const said = await app.find(
    (line) => line.type === "section" && line.project === PROJECT,
  );
  expect(said.line).toMatchObject({
    id: "pulls",
    detail: "Needs a sign-in to GitHub.",
    rows: [{ id: "need:sign-in", state: "waiting" }],
    actions: [{ id: "refresh", label: "Check again" }],
  });
  expect(said.line.session).toBeUndefined();

  await writeFile(join(dir, "in"), "");
  app.send({
    type: "action",
    id: "a1",
    section: "pulls",
    action: "refresh",
    row: null,
    input: {},
    project: PROJECT,
  });
  const quiet = await app.find(
    (line) =>
      line.type === "section" &&
      line.project === PROJECT &&
      line.rows.length === 0,
    said.at + 1,
  );
  expect(quiet.line.detail).toBeUndefined();
  expect(quiet.line.actions).toEqual([]);

  app.send({ type: "stop" });
  await done;
});
