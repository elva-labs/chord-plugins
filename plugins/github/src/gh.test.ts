import { expect, it } from "vitest";
import { said, troubleOf } from "./gh.js";

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
