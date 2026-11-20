/**
 * The repository a folder is a checkout of, read from its git remotes the
 * way gh picks one: the remote gh was told is the base, else upstream,
 * github, origin, and then the first. That is where a session's pull
 * requests are opened; the remotes are where their branches can come from.
 */

import { execFile } from "node:child_process";
import { repoKey, repoOfRemote, type Repo } from "./address.js";

/** A folder's repository, and every repository its remotes point at. */
export interface Place {
  base: Repo;
  remotes: Repo[];
}

/** Reads a folder's remotes as `git config --get-regexp` lists them, or
    answers with nothing for a folder that is not a checkout. */
export type Remotes = (cwd: string) => Promise<string>;

/** Asks git in the folder. */
export const remotes: Remotes = (cwd) =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["config", "--get-regexp", "^remote\\."],
      { cwd, timeout: 10_000, windowsHide: true },
      (error, stdout) => resolve(error === null ? stdout : ""),
    );
  });

const ORDER = ["upstream", "github", "origin"];

/** The place a folder's remotes describe, or null when none of them is on
    a host. */
export function placeOf(listing: string): Place | null {
  const urls = new Map<string, string>();
  let based: string | null = null;
  const names: string[] = [];
  for (const line of listing.split("\n")) {
    const found = /^remote\.(.+)\.(url|gh-resolved)\s+(.*)$/.exec(line.trim());
    if (found === null) continue;
    const [, name, key, value] = found;
    if (!name || value === undefined) continue;
    if (key === "url" && !urls.has(name)) {
      urls.set(name, value);
      names.push(name);
    }
    if (key === "gh-resolved" && value.trim() === "base") based = name;
  }
  const repos = new Map<string, Repo>();
  for (const name of names) {
    const repo = repoOfRemote(urls.get(name) ?? "");
    if (repo !== null) repos.set(name, repo);
  }
  if (repos.size === 0) return null;
  const ranked = [...repos.keys()].sort((a, b) => rank(a) - rank(b));
  const chosen =
    based !== null && repos.has(based) ? based : (ranked[0] as string);
  const base = repos.get(chosen) as Repo;
  const seen = new Set<string>();
  const all: Repo[] = [];
  for (const repo of [base, ...repos.values()]) {
    const key = repoKey(repo);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(repo);
  }
  return { base, remotes: all };
}

function rank(name: string): number {
  const at = ORDER.indexOf(name);
  return at === -1 ? ORDER.length : at;
}
