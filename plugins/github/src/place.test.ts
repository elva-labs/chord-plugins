import { expect, it } from "vitest";
import { placeOf } from "./place.js";

const API = { host: "github.com", owner: "orbit", name: "api" };
const FORK = { host: "github.com", owner: "ada", name: "api" };

function listing(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

it("takes the remote gh was told is the base", () => {
  expect(
    placeOf(
      listing(
        "remote.origin.url git@github.com:ada/api.git",
        "remote.origin.fetch +refs/heads/*:refs/remotes/origin/*",
        "remote.team.url https://github.com/orbit/api.git",
        "remote.team.gh-resolved base",
      ),
    ),
  ).toEqual({ base: API, remotes: [API, FORK] });
});

it("takes upstream, then github, then origin, then the first remote", () => {
  const both = [
    "remote.origin.url git@github.com:ada/api.git",
    "remote.upstream.url git@github.com:orbit/api.git",
  ];
  expect(placeOf(listing(...both))?.base).toEqual(API);
  expect(
    placeOf(
      listing(
        "remote.origin.url git@github.com:ada/api.git",
        "remote.github.url git@github.com:orbit/api.git",
      ),
    )?.base,
  ).toEqual(API);
  expect(
    placeOf(
      listing(
        "remote.mirror.url git@github.com:orbit/api.git",
        "remote.origin.url git@github.com:ada/api.git",
      ),
    )?.base,
  ).toEqual(FORK);
  expect(
    placeOf(
      listing(
        "remote.second.url git@github.com:ada/api.git",
        "remote.first.url git@github.com:orbit/api.git",
      ),
    )?.base,
  ).toEqual(FORK);
});

it("passes over remotes on no host, and answers null when none is on one", () => {
  expect(
    placeOf(
      listing(
        "remote.upstream.url /srv/mirror/api.git",
        "remote.origin.url ssh://git@GHE.corp.example/platform/infra.git",
      ),
    ),
  ).toEqual({
    base: { host: "ghe.corp.example", owner: "platform", name: "infra" },
    remotes: [{ host: "ghe.corp.example", owner: "platform", name: "infra" }],
  });
  expect(placeOf(listing("remote.origin.url /srv/mirror/api.git"))).toBeNull();
  expect(placeOf("")).toBeNull();
});

it("lists a repository once however many remotes point at it", () => {
  expect(
    placeOf(
      listing(
        "remote.origin.url git@github.com:orbit/api.git",
        "remote.https.url https://github.com/orbit/api",
        "remote.origin.pushurl git@github.com:ada/api.git",
      ),
    ),
  ).toEqual({ base: API, remotes: [API] });
});
