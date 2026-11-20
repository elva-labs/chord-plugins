import { expect, it } from "vitest";
import {
  pullKey,
  pullOfUrl,
  pullUrls,
  refOfKey,
  repoKey,
  repoOfRemote,
  shellWords,
  urlOf,
  wordsOf,
} from "./address.js";

it("keys a repository and a pull request the same whatever their case", () => {
  const ref = { host: "GitHub.com", owner: "Orbit", name: "API", number: 7 };

  expect(repoKey(ref)).toBe("github.com/orbit/api");
  expect(pullKey(ref)).toBe("github.com/orbit/api#7");
  expect(refOfKey(pullKey(ref))).toEqual({
    host: "github.com",
    owner: "orbit",
    name: "api",
    number: 7,
  });
  expect(refOfKey("github.com/orbit/api")).toBeNull();
  expect(refOfKey("not a key#1")).toBeNull();
});

it("finds every pull request a text names by address, in order", () => {
  const text = [
    "Creating pull request for retry-upload into main in orbit/api",
    "",
    "https://github.com/orbit/api/pull/41",
    "see also https://GHE.corp.example:8443/Platform/infra/pull/9/files",
  ].join("\n");

  expect(pullUrls(text)).toEqual([
    { host: "github.com", owner: "orbit", name: "api", number: 41 },
    {
      host: "ghe.corp.example:8443",
      owner: "Platform",
      name: "infra",
      number: 9,
    },
  ]);
  expect(pullUrls("https://github.com/orbit/api/issues/3")).toEqual([]);
});

it("reads an address as a pull request only when the address is all there is", () => {
  expect(pullOfUrl("https://github.com/orbit/api/pull/41")).toEqual({
    host: "github.com",
    owner: "orbit",
    name: "api",
    number: 41,
  });
  expect(pullOfUrl("41")).toBeNull();
  expect(pullOfUrl("see https://github.com/orbit/api/pull/41")).toBeNull();
  expect(
    urlOf({ host: "github.com", owner: "orbit", name: "api", number: 41 }),
  ).toBe("https://github.com/orbit/api/pull/41");
});

it("reads the repository from a remote in each way git writes one", () => {
  const api = { host: "github.com", owner: "orbit", name: "api" };
  expect(repoOfRemote("git@github.com:orbit/api.git")).toEqual(api);
  expect(repoOfRemote("https://github.com/orbit/api.git")).toEqual(api);
  expect(repoOfRemote("https://ada@github.com/orbit/api")).toEqual(api);
  expect(repoOfRemote("ssh://git@ssh.github.com:443/orbit/api.git")).toEqual(
    api,
  );
  expect(repoOfRemote("ssh://git@GHE.corp.example/platform/infra.git")).toEqual(
    {
      host: "ghe.corp.example",
      owner: "platform",
      name: "infra",
    },
  );
  expect(repoOfRemote("/srv/mirror/api.git")).toBeNull();
  expect(repoOfRemote("file:///srv/mirror/api.git")).toBeNull();
  expect(repoOfRemote("https://gitlab.example/group/sub/api.git")).toBeNull();
});

it("cuts a line into words as a shell does", () => {
  expect(
    shellWords(`gh pr create --title "Retry it" -b 'a; b' && echo done`),
  ).toEqual([
    "gh",
    "pr",
    "create",
    "--title",
    "Retry it",
    "-b",
    "a; b",
    "&&",
    "echo",
    "done",
  ]);
  expect(shellWords("a\\ b|c")).toEqual(["a b", "|", "c"]);
});

it("reads what a gh pr command does and what it names", () => {
  expect(wordsOf("gh pr create --fill")).toEqual({
    verb: "create",
    target: null,
    repo: null,
    head: null,
  });
  expect(
    wordsOf("gh pr create -t 'Retry' -H ada:retry-upload -R orbit/api"),
  ).toEqual({
    verb: "create",
    target: null,
    repo: "orbit/api",
    head: "ada:retry-upload",
  });
  expect(wordsOf("gh pr merge 41 --squash --delete-branch")).toEqual({
    verb: "merge",
    target: "41",
    repo: null,
    head: null,
  });
  expect(
    wordsOf("gh pr merge --body 'done' https://github.com/orbit/api/pull/41"),
  ).toMatchObject({
    verb: "merge",
    target: "https://github.com/orbit/api/pull/41",
  });
  expect(wordsOf("gh pr close --comment=stale 9 --repo=orbit/web")).toEqual({
    verb: "close",
    target: "9",
    repo: "orbit/web",
    head: null,
  });
  expect(wordsOf("gh pr ready")).toMatchObject({ verb: "ready", target: null });
  expect(wordsOf("gh pr ready -- 12")).toMatchObject({ target: "12" });
});

it("reads gh inside a shell it was handed to, and past other commands", () => {
  expect(wordsOf(`bash -lc 'cd api && gh pr create --fill'`)).toMatchObject({
    verb: "create",
  });
  expect(
    wordsOf("git push -u origin HEAD && /opt/bin/gh pr ready 3"),
  ).toMatchObject({
    verb: "ready",
    target: "3",
  });
  expect(wordsOf("gh pr merge 4 | tee log")).toMatchObject({ target: "4" });
  expect(wordsOf("GH_HOST=ghe.corp.example gh pr close 5")).toMatchObject({
    verb: "close",
    target: "5",
  });
  expect(wordsOf(`sh -c "zsh -c 'gh pr ready 6'"`)).toMatchObject({
    target: "6",
  });
});

it("hears nothing in a command that makes, merges, closes or readies no pull request", () => {
  expect(wordsOf("gh pr view 41")).toBeNull();
  expect(wordsOf("gh pr list")).toBeNull();
  expect(wordsOf("echo gh pr create")).toBeNull();
  expect(wordsOf("git commit -m 'gh pr create'")).toBeNull();
  expect(wordsOf("grep 'gh pr merge' notes")).toBeNull();
  expect(wordsOf("")).toBeNull();
});
