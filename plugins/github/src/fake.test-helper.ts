/**
 * What the tests stand in with: pull requests as the plugin keeps them,
 * GitHub's answers as gh prints them, a gh that answers from a script and
 * writes down every call, and a clock the test moves itself.
 */

import { pullKey, type Repo } from "./address.js";
import type { Gh, Run, Where } from "./gh.js";
import type { Session } from "./mapping.js";
import type { Pull } from "./pulls.js";
import type { Clock } from "./schedule.js";

export const REPO: Repo = { host: "github.com", owner: "orbit", name: "api" };

/** A pull request as the plugin keeps it: open, ready, mergeable and
    with nothing asked of anyone, unless the test says otherwise. */
export function pull(over: Partial<Pull> = {}): Pull {
  const repo = {
    host: over.host ?? REPO.host,
    owner: over.owner ?? REPO.owner,
    name: over.name ?? REPO.name,
  };
  const number = over.number ?? 42;
  return {
    ...repo,
    number,
    key: pullKey({ ...repo, number }),
    title: "Retry the upload",
    url: `https://${repo.host}/${repo.owner}/${repo.name}/pull/${number}`,
    state: "OPEN",
    draft: false,
    head: "retry-upload",
    headOid: "a1b2c3",
    headRepo: repo,
    base: "main",
    mergeable: "MERGEABLE",
    mergeState: "CLEAN",
    decision: null,
    checks: [],
    reviews: [],
    asked: [],
    closedAt: null,
    ...over,
  };
}

/** A session as the plugin keeps it. */
export function session(over: Partial<Session> & { id: string }): Session {
  return {
    project: "/srv/orbit",
    cwd: "/srv/orbit",
    worktree: false,
    branch: null,
    ...over,
  };
}

/** A check run in GitHub's answer. */
export interface Ran {
  name: string;
  status?: string;
  conclusion?: string | null;
  workflow?: string;
  /** Null for a run that has not started. */
  startedAt?: string | null;
}

/** A pull request as GitHub's answer holds it. */
export interface Node {
  number: number;
  title?: string;
  state?: "OPEN" | "CLOSED" | "MERGED";
  isDraft?: boolean;
  headRefName?: string;
  headRefOid?: string;
  baseRefName?: string;
  mergeable?: string;
  mergeStateStatus?: string;
  reviewDecision?: string | null;
  closedAt?: string | null;
  mergedAt?: string | null;
  headRepository?: { name: string; owner: { login: string } } | null;
  checks?: Ran[];
  /** GitHub's state of every check together. */
  rollup?: string;
  /** How many checks there are, when more than are given. */
  total?: number;
  statuses?: { context: string; state: string; createdAt?: string }[];
  reviews?: {
    login: string;
    name?: string;
    state: string;
    submittedAt: string;
  }[];
  asked?: ({ login: string; name?: string } | { team: string })[];
  repo?: Repo;
}

/** A pull request's node, as GitHub writes it. */
export function node(given: Node): Record<string, unknown> {
  const repo = given.repo ?? REPO;
  return {
    number: given.number,
    title: given.title ?? "Retry the upload",
    url: `https://${repo.host}/${repo.owner}/${repo.name}/pull/${given.number}`,
    state: given.state ?? "OPEN",
    isDraft: given.isDraft ?? false,
    headRefName: given.headRefName ?? "retry-upload",
    headRefOid: given.headRefOid ?? "a1b2c3",
    baseRefName: given.baseRefName ?? "main",
    mergeable: given.mergeable ?? "MERGEABLE",
    mergeStateStatus: given.mergeStateStatus ?? "CLEAN",
    reviewDecision: given.reviewDecision ?? null,
    closedAt: given.closedAt ?? null,
    mergedAt: given.mergedAt ?? null,
    headRepository:
      given.headRepository === undefined
        ? { name: repo.name, owner: { login: repo.owner } }
        : given.headRepository,
    reviewRequests: {
      nodes: (given.asked ?? []).map((one) =>
        "team" in one
          ? { requestedReviewer: { __typename: "Team", name: one.team } }
          : {
              requestedReviewer: {
                __typename: "User",
                login: one.login,
                name: one.name ?? null,
              },
            },
      ),
    },
    latestReviews: {
      nodes: (given.reviews ?? []).map((one) => ({
        state: one.state,
        submittedAt: one.submittedAt,
        author: { login: one.login, name: one.name ?? null },
      })),
    },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: given.rollup ?? "SUCCESS",
              contexts: {
                totalCount:
                  given.total ??
                  (given.checks ?? []).length + (given.statuses ?? []).length,
                nodes: [
                  ...(given.checks ?? []).map((one) => ({
                    __typename: "CheckRun",
                    name: one.name,
                    status: one.status ?? "COMPLETED",
                    conclusion:
                      one.conclusion === undefined ? "SUCCESS" : one.conclusion,
                    startedAt:
                      one.startedAt === undefined
                        ? "2026-11-20T10:00:00Z"
                        : one.startedAt,
                    completedAt: null,
                    checkSuite: one.workflow
                      ? { workflowRun: { workflow: { name: one.workflow } } }
                      : { workflowRun: null },
                  })),
                  ...(given.statuses ?? []).map((one) => ({
                    __typename: "StatusContext",
                    context: one.context,
                    state: one.state,
                    createdAt: one.createdAt ?? "2026-11-20T10:00:00Z",
                  })),
                ],
              },
            },
          },
        },
      ],
    },
  };
}

/** What a repository's answer holds besides its pull requests. */
export interface Answer {
  numbers?: (Record<string, unknown> | null)[];
  branches?: Record<string, unknown>[][];
  permission?: string;
  method?: string;
  allowed?: ("merge" | "squash" | "rebase")[];
  viewer?: string;
  remaining?: number;
  resetAt?: string;
}

/** A repository's answer, as `gh api graphql` prints it. */
export function answer(given: Answer = {}): string {
  const repository: Record<string, unknown> = {
    viewerPermission: given.permission ?? "WRITE",
    viewerDefaultMergeMethod: given.method ?? "SQUASH",
    mergeCommitAllowed: (given.allowed ?? ["merge", "squash"]).includes(
      "merge",
    ),
    squashMergeAllowed: (given.allowed ?? ["merge", "squash"]).includes(
      "squash",
    ),
    rebaseMergeAllowed: (given.allowed ?? ["merge", "squash"]).includes(
      "rebase",
    ),
  };
  (given.numbers ?? []).forEach((one, at) => {
    repository[`n${at}`] = one;
  });
  (given.branches ?? []).forEach((nodes, at) => {
    repository[`b${at}`] = { nodes };
  });
  return JSON.stringify({
    data: {
      viewer: { login: given.viewer ?? "ada" },
      rateLimit: {
        remaining: given.remaining ?? 4800,
        resetAt: given.resetAt ?? "2026-11-20T11:00:00Z",
      },
      repository,
    },
  });
}

/** A call gh was asked to make. */
export interface Call {
  args: string[];
  where: Where;
}

/** What a scripted gh answers a call with: a run, or an error to throw. */
export type Script = (call: Call) => Run | Error | Promise<Run | Error>;

/** A gh that answers from a script and keeps every call it was asked. */
export function fakeGh(script: Script): Gh & { calls: Call[] } {
  const calls: Call[] = [];
  const run = (async (args: string[], where: Where = {}) => {
    const call = { args, where };
    calls.push(call);
    const said = await script(call);
    if (said instanceof Error) throw said;
    return said;
  }) as Gh & { calls: Call[] };
  run.calls = calls;
  return run;
}

/** A run that went well and printed this. */
export function ok(stdout: string): Run {
  return { stdout, stderr: "", code: 0 };
}

/** A run that failed and said this. */
export function failed(stderr: string, code = 1): Run {
  return { stdout: "", stderr, code };
}

/** The values a GraphQL call was given with -f, by name. */
export function fieldsOf(args: string[]): Map<string, string> {
  const fields = new Map<string, string>();
  for (let at = 0; at < args.length; at++) {
    if (args[at] !== "-f") continue;
    const value = args[at + 1] ?? "";
    const equals = value.indexOf("=");
    fields.set(value.slice(0, equals), value.slice(equals + 1));
  }
  return fields;
}

/** The pull requests a GraphQL call asked for by number, in order. */
export function numbersOf(args: string[]): number[] {
  const query = fieldsOf(args).get("query") ?? "";
  return [...query.matchAll(/pullRequest\(number: (\d+)\)/g)].map((m) =>
    Number(m[1]),
  );
}

/** The branches a GraphQL call asked about, in order. */
export function branchesOf(args: string[]): string[] {
  const fields = fieldsOf(args);
  const found: string[] = [];
  for (let at = 0; fields.has(`b${at}`); at++) {
    found.push(fields.get(`b${at}`) as string);
  }
  return found;
}

/** A clock the test moves: timers fire only when it is moved past them. */
export class FakeClock implements Clock {
  at: number;
  #timers: { at: number; fn: () => void; id: number }[] = [];
  #ids = 0;

  constructor(at = Date.parse("2026-11-20T10:30:00Z")) {
    this.at = at;
  }

  now(): number {
    return this.at;
  }

  after(ms: number, fn: () => void): () => void {
    const id = ++this.#ids;
    this.#timers.push({ at: this.at + ms, fn, id });
    return () => {
      this.#timers = this.#timers.filter((timer) => timer.id !== id);
    };
  }

  /** How many timers are waiting. */
  get waiting(): number {
    return this.#timers.length;
  }

  /** When the next timer fires, or null. */
  get next(): number | null {
    if (this.#timers.length === 0) return null;
    return Math.min(...this.#timers.map((timer) => timer.at));
  }

  /** Moves time on, firing each timer due on the way, and lets what they
      started run. */
  async move(ms: number): Promise<void> {
    const end = this.at + ms;
    for (;;) {
      const due = this.#timers
        .filter((timer) => timer.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.#timers = this.#timers.filter((timer) => timer !== due);
      this.at = due.at;
      due.fn();
      await settle();
    }
    this.at = end;
    await settle();
  }
}

/** Lets every promise already on its way run. */
export async function settle(): Promise<void> {
  for (let at = 0; at < 20; at++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** A pull request in the search for reviews asked, as GitHub writes it. */
export interface Sought extends Node {
  author?: { login: string; name?: string } | null;
  createdAt?: string;
  /** Whether its head is a fork's. */
  isCrossRepository?: boolean;
}

/** The search for reviews asked, as `gh api graphql` prints it. */
export function search(
  nodes: Sought[],
  given: { viewer?: string; remaining?: number; resetAt?: string } = {},
): string {
  return JSON.stringify({
    data: {
      viewer: { login: given.viewer ?? "ada" },
      rateLimit: {
        remaining: given.remaining ?? 4800,
        resetAt: given.resetAt ?? "2026-11-20T11:00:00Z",
      },
      search: {
        nodes: nodes.map((one) => {
          const repo = one.repo ?? REPO;
          return {
            ...node(one),
            createdAt: one.createdAt ?? "2026-11-20T09:00:00Z",
            isCrossRepository: one.isCrossRepository ?? false,
            author:
              one.author === undefined
                ? { login: "grace", name: "Grace Hopper" }
                : one.author,
            repository: { name: repo.name, owner: { login: repo.owner } },
          };
        }),
      },
    },
  });
}
