/**
 * How a pull request stands, in words and in one of four states, worked
 * out from what was read and from nothing else. The state is the worst of
 * its checks and its reviews: a failing check or changes asked for is
 * failed, a review still to come is waiting, a check still running is
 * busy, and the rest is ok.
 */

import type { Pull } from "./pulls.js";

/** How something stands, worst last. */
export type State = "ok" | "busy" | "waiting" | "failed";

const ORDER: State[] = ["ok", "busy", "waiting", "failed"];

/** The worst of some states, or null when there are none. */
export function worst(states: (State | null)[]): State | null {
  let found: State | null = null;
  for (const state of states) {
    if (state === null) continue;
    if (found === null || ORDER.indexOf(state) > ORDER.indexOf(found)) {
      found = state;
    }
  }
  return found;
}

/** A pull request's checks, counted. */
export interface Checks {
  failed: string[];
  passed: number;
  running: number;
  skipped: number;
  state: State | null;
}

/** How the checks stand: failed when one failed, busy while one runs,
    ok when all are done, and null when there are none. */
export function checksOf(pull: Pull): Checks {
  const failed: string[] = [];
  let passed = 0;
  let running = 0;
  let skipped = 0;
  for (const check of pull.checks) {
    if (check.bucket === "fail") failed.push(check.name);
    else if (check.bucket === "pass") passed++;
    else if (check.bucket === "pending") running++;
    else skipped++;
  }
  const state: State | null =
    failed.length > 0
      ? "failed"
      : running > 0
        ? "busy"
        : passed + skipped > 0
          ? "ok"
          : null;
  return { failed, passed, running, skipped, state };
}

/** Where the reviews stand. */
export interface Reviews {
  kind: "approved" | "changes" | "asked" | "none";
  /** Who approved, asked for changes, or was asked. */
  who: string[];
  state: State | null;
}

/** How the reviews stand: changes asked for, approved, a review still to
    come, or nothing asked of anyone. */
export function reviewsOf(pull: Pull): Reviews {
  const by = (state: string): string[] =>
    pull.reviews.filter((review) => review.state === state).map((r) => r.who);
  const changes = by("CHANGES_REQUESTED");
  if (pull.decision === "CHANGES_REQUESTED" || changes.length > 0) {
    return { kind: "changes", who: changes, state: "failed" };
  }
  if (pull.asked.length > 0 || pull.decision === "REVIEW_REQUIRED") {
    return { kind: "asked", who: pull.asked, state: "waiting" };
  }
  const approved = by("APPROVED");
  if (pull.decision === "APPROVED" || approved.length > 0) {
    return { kind: "approved", who: approved, state: "ok" };
  }
  return { kind: "none", who: [], state: null };
}

/** A pull request's state: the worst of its checks and its reviews while
    it is open, ok once merged, and none once closed. */
export function stateOf(pull: Pull): State | null {
  if (pull.state === "MERGED") return "ok";
  if (pull.state === "CLOSED") return null;
  return worst([checksOf(pull).state, reviewsOf(pull).state]) ?? "ok";
}

/** Whether it can be merged as it is, conflicts and branch rules
    included. */
export function readyToMerge(pull: Pull): boolean {
  return (
    pull.state === "OPEN" &&
    !pull.draft &&
    pull.mergeable === "MERGEABLE" &&
    (pull.mergeState === "CLEAN" ||
      pull.mergeState === "HAS_HOOKS" ||
      pull.mergeState === "UNSTABLE")
  );
}

/** What a pull request is waiting on, in a few words. */
export function summaryOf(pull: Pull): string {
  if (pull.state === "MERGED") return "merged";
  if (pull.state === "CLOSED") return "closed";
  const checks = checksOf(pull);
  const reviews = reviewsOf(pull);
  if (checks.failed.length > 0) {
    return checks.failed.length === 1
      ? "a check failed"
      : `${checks.failed.length} checks failed`;
  }
  if (reviews.kind === "changes") return "changes requested";
  if (pull.mergeable === "CONFLICTING") return "conflicts";
  if (pull.draft) return "draft";
  if (checks.running > 0) return "checks running";
  if (reviews.kind === "asked") return "waiting on review";
  if (readyToMerge(pull)) return "ready to merge";
  if (pull.mergeState === "BEHIND") return `behind ${pull.base}`;
  if (pull.mergeState === "BLOCKED") return "blocked";
  return "open";
}

/** The mark of a session's open pull requests: how many, the worst of
    their states, and a few words on why. */
export interface Tally {
  count: number;
  state: State;
  label: string;
}

/** The tally of some pull requests, counting only the open ones, or null
    when none is open. */
export function tallyOf(pulls: Pull[]): Tally | null {
  const open = pulls.filter((pull) => pull.state === "OPEN");
  if (open.length === 0) return null;
  const state = worst(open.map(stateOf)) ?? "ok";
  const why =
    state === "failed"
      ? open.some((pull) => checksOf(pull).state === "failed")
        ? "a failing check"
        : "changes requested"
      : state === "waiting"
        ? "waiting on review"
        : state === "busy"
          ? "checks running"
          : "all well";
  const noun = open.length === 1 ? "pull request" : "pull requests";
  return { count: open.length, state, label: `${open.length} ${noun}, ${why}` };
}
