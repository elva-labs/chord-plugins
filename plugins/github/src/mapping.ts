/**
 * Which pull requests are a session's. A pull request is the session's
 * that ran the command that made it, as a claim the plugin keeps. Failing
 * a claim, a session working in the worktree the app made for it also has
 * the pull requests whose head is its branch, from one of its folder's
 * remotes, in its folder's repository. A folder alone never makes one
 * anyone's, and a pull request shows only for the sessions it is the own
 * of, never for the session that started them.
 */

import { repoKey, refOfKey, type PullRef, type Repo } from "./address.js";
import type { Place } from "./place.js";
import type { Pull } from "./pulls.js";

/** A session as the plugin keeps it. */
export interface Session {
  id: string;
  project: string;
  cwd: string;
  /** Whether the folder is a worktree the app made for this session. */
  worktree: boolean;
  /** The worktree's branch, when the app knows it. */
  branch: string | null;
}

/** How long a merged or closed pull request is still shown. */
export const KEPT_CLOSED_MS = 3 * 24 * 60 * 60 * 1000;

/** What the rule reads. */
export interface World {
  sessions: ReadonlyMap<string, Session>;
  /** The pull requests each session claimed, by session id. A pull
      request is claimed by one session at most. */
  claims: ReadonlyMap<string, readonly string[]>;
  /** Each folder's repository, or null for a folder that has none. */
  places: ReadonlyMap<string, Place | null>;
  /** Every pull request read, by key. */
  pulls: ReadonlyMap<string, Pull>;
  /** The keys found for a branch, by `branchKey`. */
  branches: ReadonlyMap<string, readonly string[]>;
  now: number;
}

/** The key of a branch in a repository. */
export function branchKey(repo: Repo, branch: string): string {
  return `${repoKey(repo)}\u0000${branch}`;
}

/** The session that claimed a pull request, or null. */
export function claimerOf(world: World, key: string): string | null {
  for (const [session, keys] of world.claims) {
    if (keys.includes(key)) return session;
  }
  return null;
}

/** Whether a pull request is still shown: open, not read yet, or merged
    or closed a short while ago. */
export function current(world: World, key: string): boolean {
  const pull = world.pulls.get(key);
  if (pull === undefined || pull.state === "OPEN") return true;
  return pull.closedAt === null || world.now - pull.closedAt < KEPT_CLOSED_MS;
}

/** The pull requests that are the session's own, claims first. */
export function owned(world: World, id: string): string[] {
  const own: string[] = [];
  const add = (key: string): void => {
    if (!own.includes(key) && current(world, key)) own.push(key);
  };
  for (const key of world.claims.get(id) ?? []) add(key);
  const session = world.sessions.get(id);
  if (session === undefined || !session.worktree || session.branch === null) {
    return own;
  }
  const place = world.places.get(session.cwd);
  if (place === undefined || place === null) return own;
  const from = new Set(place.remotes.map(repoKey));
  for (const key of world.branches.get(branchKey(place.base, session.branch)) ??
    []) {
    const pull = world.pulls.get(key);
    if (pull === undefined || pull.head !== session.branch) continue;
    if (pull.headRepo === null || !from.has(repoKey(pull.headRepo))) continue;
    const claimer = claimerOf(world, key);
    if (claimer !== null && claimer !== id) continue;
    add(key);
  }
  return own;
}

/** The sessions a pull request is the own of. */
export function owners(world: World, key: string): string[] {
  return [...world.sessions.keys()].filter((id) =>
    owned(world, id).includes(key),
  );
}

/** What to read: every pull request a known session claimed that is still
    shown, and every made worktree's branch in its folder's repository. */
export function wanted(world: World): {
  refs: PullRef[];
  branches: { repo: Repo; branch: string }[];
} {
  const refs = new Map<string, PullRef>();
  const branches = new Map<string, { repo: Repo; branch: string }>();
  for (const session of world.sessions.values()) {
    for (const key of world.claims.get(session.id) ?? []) {
      const ref = refOfKey(key);
      if (ref !== null && current(world, key)) refs.set(key, ref);
    }
    if (!session.worktree || session.branch === null) continue;
    const place = world.places.get(session.cwd);
    if (place === undefined || place === null) continue;
    branches.set(branchKey(place.base, session.branch), {
      repo: place.base,
      branch: session.branch,
    });
  }
  return { refs: [...refs.values()], branches: [...branches.values()] };
}
