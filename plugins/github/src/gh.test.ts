import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { gh, Missing, runner, said, troubleOf } from "./gh.js";

let bin: string;
let folder: string;
const path = process.env.PATH;

beforeEach(async () => {
  bin = await mkdtemp(join(tmpdir(), "github-bin-"));
  folder = await realpath(await mkdtemp(join(tmpdir(), "github-folder-")));
  process.env.PATH = `${bin}:${path}`;
});

afterEach(async () => {
  process.env.PATH = path;
  await rm(bin, { recursive: true, force: true });
  await rm(folder, { recursive: true, force: true });
});

/** Puts a gh on the PATH that runs this shell script. */
async function fake(script: string): Promise<void> {
  await writeFile(join(bin, "gh"), `#!/bin/sh\n${script}\n`, {
    mode: 0o755,
  });
}

it("runs the gh on the PATH with its arguments as they are, in the folder and for the host it is given, never prompting", async () => {
  await fake(
    [
      'for word in "$@"; do echo "[$word]"; done',
      'echo "host=$GH_HOST prompt=$GH_PROMPT_DISABLED update=$GH_NO_UPDATE_NOTIFIER colour=$NO_COLOR"',
      "pwd -P",
      "echo said >&2",
    ].join("\n"),
  );

  const run = await gh(["api", "graphql", "-f", "query=a b; $(c)"], {
    cwd: folder,
    host: "ghe.corp.example",
  });

  expect(run).toEqual({
    code: 0,
    stdout: [
      "[api]",
      "[graphql]",
      "[-f]",
      "[query=a b; $(c)]",
      "host=ghe.corp.example prompt=1 update=1 colour=1",
      folder,
      "",
    ].join("\n"),
    stderr: "said\n",
  });
});

it("answers with how a gh that failed ended, and with no gh run in a folder that is gone", async () => {
  await fake('echo "{}"; echo "HTTP 502" >&2; exit 4');

  expect(await gh(["api", "graphql"])).toEqual({
    code: 4,
    stdout: "{}\n",
    stderr: "HTTP 502\n",
  });
  expect(await gh(["pr", "view"], { cwd: join(folder, "gone") })).toEqual({
    code: 1,
    stdout: "",
    stderr: `no such folder: ${join(folder, "gone")}`,
  });
});

it("says gh is missing when the PATH holds none", async () => {
  process.env.PATH = bin;

  await expect(gh(["auth", "status"])).rejects.toBeInstanceOf(Missing);
});

it("ends a gh that does not answer in time, saying so in a few words", async () => {
  await fake("exec sleep 5");

  await expect(runner(500)(["api", "graphql"])).rejects.toThrow(
    /^gh gave no answer within 1 second$/,
  );
});

it("says what gh said on one line, from its errors or else its output", () => {
  expect(
    said({ stdout: "", stderr: "gh: Not Found\n  (HTTP 404)\n", code: 1 }),
  ).toBe("Not Found (HTTP 404)");
  expect(
    said({ stdout: "pull request is closed\n", stderr: "  ", code: 1 }),
  ).toBe("pull request is closed");
  expect(said({ stdout: "", stderr: "", code: 1 })).toBe(
    "gh failed and said nothing",
  );
  const long = said({ stdout: "", stderr: "x".repeat(400), code: 1 });
  expect(long).toHaveLength(303);
  expect(long.endsWith("...")).toBe(true);
});

it("reads what stands in the way from a call that failed", () => {
  const run = (stderr: string, code = 1) => ({ stdout: "", stderr, code });

  expect(
    troubleOf({ stdout: "{}", stderr: "", code: 0 }, "github.com"),
  ).toBeNull();
  expect(troubleOf(run("", 4), "ghe.corp.example")).toEqual({
    kind: "signed-out",
    host: "ghe.corp.example",
  });
  expect(
    troubleOf(
      run("To get started with GitHub CLI, please run:  gh auth login"),
      "github.com",
    ),
  ).toEqual({ kind: "signed-out", host: "github.com" });
  expect(troubleOf(run("HTTP 401: Bad credentials"), "github.com")).toEqual({
    kind: "signed-out",
    host: "github.com",
  });
  expect(
    troubleOf(run("HTTP 403: API rate limit exceeded for user"), "github.com"),
  ).toEqual({ kind: "limited", host: "github.com", until: null });
  expect(troubleOf(run("HTTP 502: Bad Gateway"), "github.com")).toEqual({
    kind: "failed",
    host: "github.com",
    text: "HTTP 502: Bad Gateway",
  });
});
