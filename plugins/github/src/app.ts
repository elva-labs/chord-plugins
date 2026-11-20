/**
 * The app's shapes, and the only module that knows them: a session and a
 * heard command as the app tells them, and the fold, its rows and facts,
 * the mark and the actions as the app draws them. Everything else in the
 * plugin works on its own types and comes here to be told or drawn.
 */

import type {
  Action,
  CommandEvent,
  Fact,
  Mark,
  Row,
  SessionEvent,
} from "@elva-labs/workbench-plugin";
import { basename } from "node:path";
import type { Trouble } from "./gh.js";
import type { Session } from "./mapping.js";
import type { Pull } from "./pulls.js";
import {
  checksOf,
  readyToMerge,
  reviewsOf,
  stateOf,
  summaryOf,
  type Tally,
} from "./standing.js";

/** The fold's id and title. */
export const SECTION = "pulls";
export const TITLE = "Pull requests";

/** The actions, by id. */
export const OPEN = "open";
export const MERGE = "merge";
export const REFRESH = "refresh";

/** A session as the app tells it, and whether it ended, or null for one
    without an id. An app that says nothing of a folder or a worktree gives
    the project's folder and no worktree. */
export function sessionOf(
  event: SessionEvent,
): { session: Session; ended: boolean } | null {
  if (typeof event.id !== "string" || event.id === "") return null;
  const worktree = event.worktree === true;
  return {
    ended: event.event === "ended",
    session: {
      id: event.id,
      project: event.project,
      cwd: filled(event.cwd) ?? event.project,
      worktree,
      branch: worktree ? filled(event.branch) : null,
      startedBy: filled(event.startedBy),
    },
  };
}

function filled(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** A command a session ran, as the plugin reads it. */
export interface Heard {
  project: string;
  session: string;
  cwd: string;
  /** The words of the command that matched, as the app gives them. */
  command: string;
  ok: boolean;
  /** What it printed, or null when the app held it back. */
  output: string | null;
}

/** A heard command as the app tells it. Output the app held back, because
    the command shared a line with others that print, reads as none. */
export function heardOf(event: CommandEvent): Heard {
  const withheld = event.withheld === true;
  return {
    project: event.project,
    session: event.session,
    cwd: event.cwd !== "" ? event.cwd : event.project,
    command: event.command,
    ok: event.ok,
    output: withheld || typeof event.output !== "string" ? null : event.output,
  };
}

/** A pull request as a session's fold shows it. */
export interface Line {
  pull: Pull;
  /** The session it came from, when that is one this session started. */
  from: Session | null;
  /** How it would be merged, when the user may merge it as it is. */
  merge: "merge" | "squash" | "rebase" | null;
}

/** What a session's fold shows. */
export interface View {
  lines: Line[];
  trouble: Trouble | null;
}

const ROW = "pr:";

/** A row's id for a pull request's key. */
export function rowId(key: string): string {
  return `${ROW}${key}`;
}

/** The key a row's id names, or null for a row that is not a pull
    request's. */
export function keyOfRow(id: string | undefined): string | null {
  return id?.startsWith(ROW) === true ? id.slice(ROW.length) : null;
}

/** The fold's rows. */
export function rowsOf(view: View): Row[] {
  const repos = new Set(
    view.lines.map(
      (line) => `${line.pull.host}/${line.pull.owner}/${line.pull.name}`,
    ),
  );
  return view.lines.map((line) => rowOf(line, repos.size > 1));
}

/** One pull request's row. */
export function rowOf(line: Line, withRepo: boolean): Row {
  const { pull } = line;
  const parts = [
    ...(withRepo ? [pull.name] : []),
    pull.head,
    summaryOf(pull),
    ...(line.from === null ? [] : [`from ${nameOf(line.from)}`]),
  ];
  const state = stateOf(pull);
  const actions: Action[] = [{ id: OPEN, label: "Open on GitHub" }];
  if (line.merge !== null) actions.push(mergeOf(pull, line.merge));
  return {
    id: rowId(pull.key),
    label: `#${pull.number} ${pull.title}`,
    detail: parts.join(" · "),
    ...(state === null ? {} : { state }),
    actions,
    default: OPEN,
    facts: factsOf(pull).slice(0, 8),
  };
}

/** A started session's name: its branch, else its folder's. */
export function nameOf(session: Session): string {
  return session.branch ?? (basename(session.cwd) || session.id.slice(0, 8));
}

const METHOD = {
  merge: "with a merge commit",
  squash: "squashed",
  rebase: "rebased",
} as const;

function mergeOf(pull: Pull, method: keyof typeof METHOD): Action {
  return {
    id: MERGE,
    label: "Merge",
    input: [
      {
        id: "sure",
        label: `Merge #${pull.number} into ${pull.base}, ${METHOD[method]}?`,
        kind: "choice",
        options: [
          { id: "no", label: "No" },
          { id: "yes", label: "Yes, merge it" },
        ],
      },
    ],
  };
}

/** Whether the user said yes when asked. */
export function confirmed(input: Record<string, string>): boolean {
  return input.sure === "yes";
}

/** What a row says of its checks, reviews, conflicts and draft. */
export function factsOf(pull: Pull): Fact[] {
  const facts: Fact[] = [];
  if (pull.state === "MERGED") {
    facts.push({ label: "Merged", text: `into ${pull.base}`, state: "ok" });
  } else if (pull.state === "CLOSED") {
    facts.push({ label: "Closed", text: "without merging" });
  }

  const checks = checksOf(pull);
  const counts = (parts: [number, string][]): string =>
    parts
      .filter(([n]) => n > 0)
      .map(([n, word]) => `${n} ${word}`)
      .join(", ");
  if (checks.failed.length > 0) {
    const others = counts([
      [checks.passed, "passed"],
      [checks.running, "running"],
    ]);
    facts.push({
      label: names(checks.failed),
      text: others === "" ? "failed" : `failed · ${others}`,
      state: "failed",
    });
  } else if (checks.running > 0) {
    facts.push({
      label: `${checks.running} ${checks.running === 1 ? "check" : "checks"} running`,
      text: counts([[checks.passed, "passed"]]) || null,
      state: "busy",
    });
  } else if (checks.passed > 0) {
    facts.push({
      label: `${checks.passed} ${checks.passed === 1 ? "check" : "checks"} passed`,
      text: checks.skipped > 0 ? `${checks.skipped} skipped` : null,
      state: "ok",
    });
  } else if (checks.skipped > 0) {
    facts.push({ label: `${checks.skipped} checks skipped`, state: "ok" });
  }

  const reviews = reviewsOf(pull);
  if (reviews.kind === "changes") {
    facts.push({
      label: "Changes requested",
      text: reviews.who.length > 0 ? `by ${people(reviews.who)}` : null,
      state: "failed",
    });
  } else if (reviews.kind === "asked") {
    facts.push(
      reviews.who.length > 0
        ? {
            label: "Review asked",
            text: `of ${people(reviews.who)}`,
            state: "waiting",
          }
        : { label: "Review required", state: "waiting" },
    );
  } else if (reviews.kind === "approved") {
    facts.push({
      label: "Approved",
      text: reviews.who.length > 0 ? `by ${people(reviews.who)}` : null,
      state: "ok",
    });
  }

  if (pull.state !== "OPEN") return facts;
  if (pull.mergeable === "CONFLICTING") {
    facts.push({
      label: "Conflicts",
      text: `with ${pull.base}`,
      state: "failed",
    });
  } else if (pull.mergeable === "MERGEABLE") {
    facts.push({
      label: "No conflicts",
      text: readyToMerge(pull)
        ? "ready"
        : pull.mergeState === "BEHIND"
          ? `behind ${pull.base}`
          : pull.mergeState === "BLOCKED"
            ? "blocked by the branch's rules"
            : null,
      state: readyToMerge(pull) ? "ok" : null,
    });
  }
  if (pull.draft) facts.push({ label: "Draft" });
  return facts;
}

function names(failed: string[]): string {
  if (failed.length <= 2) return failed.join(", ");
  return `${failed.slice(0, 2).join(", ")} and ${failed.length - 2} more`;
}

function people(who: string[]): string {
  if (who.length <= 1) return who.join("");
  if (who.length <= 3) {
    return `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}`;
  }
  return `${who.slice(0, 2).join(", ")} and ${who.length - 2} more`;
}

/** The fold's header: Try again while something stands in the way, else
    Refresh, and nothing at all when the fold is empty. */
export function headerOf(view: View): Action[] {
  if (view.trouble !== null) return [{ id: REFRESH, label: "Try again" }];
  if (view.lines.length === 0) return [];
  return [{ id: REFRESH, label: "Refresh" }];
}

/** The line beside the fold's title: what stands in the way and what to
    do about it, or whose pull requests these are. */
export function detailOf(view: View, now: number): string | null {
  const trouble = view.trouble;
  if (trouble === null) return view.lines.length === 0 ? null : "this session";
  switch (trouble.kind) {
    case "missing":
      return "gh is not on the PATH. Install the GitHub CLI (cli.github.com), then Try again.";
    case "signed-out":
      return `Not signed in to ${trouble.host}. Run gh auth login --hostname ${trouble.host} in a terminal, then Try again.`;
    case "limited": {
      if (trouble.until === null || trouble.until <= now) {
        return `Rate limited on ${trouble.host}, trying again in a few minutes.`;
      }
      const minutes = Math.max(1, Math.ceil((trouble.until - now) / 60_000));
      return `Rate limited on ${trouble.host}, trying again in ${minutes} min.`;
    }
    case "failed":
      return `gh failed on ${trouble.host}: ${trouble.text}`;
  }
}

/** The mark on a session's row, or null to take it away. */
export function markOf(tally: Tally | null): Mark | null {
  if (tally === null) return null;
  return {
    icon: "pull-request",
    count: tally.count,
    state: tally.state,
    label: tally.label,
  };
}
