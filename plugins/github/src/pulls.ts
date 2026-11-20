/**
 * Pull requests as this plugin knows them, and the one call per repository
 * that reads them: a GraphQL query through `gh api` that asks for every
 * pull request wanted there, by number and by head branch, with their
 * checks and reviews, and for what the signed-in user may do with them.
 * Nothing here knows about sessions or about the app.
 */

import { pullKey, repoKey, type PullRef, type Repo } from "./address.js";
import { Missing, troubleOf, type Gh, type Trouble } from "./gh.js";

/** How a check stands, in gh's own buckets. */
export type Bucket = "pass" | "fail" | "pending" | "skipping";

/** One check on the head commit: a check run or a commit status. */
export interface Check {
  name: string;
  bucket: Bucket;
}

/** A reviewer's latest review. */
export interface Review {
  login: string;
  /** The reviewer's name, or their login when they gave none. */
  who: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | string;
  /** When it was submitted, in milliseconds since the epoch. */
  at: number;
}

/** A pull request. */
export interface Pull extends PullRef {
  key: string;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  draft: boolean;
  head: string;
  headOid: string;
  /** The repository the head branch is in, or null when it is gone. */
  headRepo: Repo | null;
  base: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  /** GitHub's mergeStateStatus: CLEAN, BLOCKED, BEHIND, DIRTY, ... */
  mergeState: string;
  /** GitHub's reviewDecision, or null when the repository asks for none. */
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  checks: Check[];
  reviews: Review[];
  /** Who has been asked for a review and has not given one yet. */
  asked: string[];
  /** When it was merged or closed, in milliseconds since the epoch. */
  closedAt: number | null;
}

/** How the signed-in user may merge into a repository. */
export interface Rights {
  /** The user's permission: ADMIN, MAINTAIN, WRITE, TRIAGE or READ. */
  permission: string | null;
  /** The method the repository merges with by default, as gh's flag. */
  method: "merge" | "squash" | "rebase" | null;
}

/** What to read in one repository. */
export interface Ask extends Repo {
  numbers: number[];
  branches: string[];
}

/** What one repository's call answered. */
export interface Read {
  repo: Repo;
  rights: Rights;
  /** Every pull request found, by key. */
  pulls: Map<string, Pull>;
  /** The keys of the pull requests found for each branch asked about. */
  branches: Map<string, string[]>;
  /** The signed-in user's login. */
  viewer: string | null;
  /** How many calls are left, and when that count starts again, in
      milliseconds since the epoch. */
  rate: { remaining: number; resetAt: number } | null;
}

/** How many pull requests a branch is looked up for. */
const PER_BRANCH = 5;

/** How many of a head commit's checks are read. */
export const CHECKS = 100;

/** The name of a check past the first CHECKS, which stands in for those
    not read when GitHub says one of them failed or is running. */
export const UNREAD = `A check past the first ${CHECKS}`;

const PULL = `fragment pull on PullRequest {
  number title url state isDraft headRefName headRefOid baseRefName
  mergeable mergeStateStatus reviewDecision closedAt mergedAt
  headRepository { name owner { login } }
  reviewRequests(first: 20) { nodes { requestedReviewer {
    __typename
    ... on User { login name }
    ... on Team { name }
    ... on Bot { login }
    ... on Mannequin { login }
  } } }
  latestReviews(first: 30) { nodes {
    state submittedAt
    author { login ... on User { name } }
  } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: ${CHECKS}) {
    totalCount
    nodes {
      __typename
      ... on CheckRun { name status conclusion startedAt completedAt
        checkSuite { workflowRun { workflow { name } } } }
      ... on StatusContext { context state createdAt }
    }
  } } } } }
}`;

/** The query for one repository, and the variables it takes. */
export function queryOf(ask: Ask): { query: string; fields: string[] } {
  const numbers = [...new Set(ask.numbers)].filter(
    (n) => Number.isSafeInteger(n) && n > 0,
  );
  const branches = [...new Set(ask.branches)];
  const declared = ["$owner: String!", "$name: String!"];
  const fields = ["-f", `owner=${ask.owner}`, "-f", `name=${ask.name}`];
  const asked: string[] = [];
  numbers.forEach((number, at) => {
    asked.push(`n${at}: pullRequest(number: ${number}) { ...pull }`);
  });
  branches.forEach((branch, at) => {
    declared.push(`$b${at}: String!`);
    fields.push("-f", `b${at}=${branch}`);
    asked.push(
      `b${at}: pullRequests(headRefName: $b${at}, first: ${PER_BRANCH}, states: [OPEN, CLOSED, MERGED], orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...pull } }`,
    );
  });
  const query = `query(${declared.join(", ")}) {
  viewer { login }
  rateLimit { remaining resetAt }
  repository(owner: $owner, name: $name) {
    viewerPermission viewerDefaultMergeMethod
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    ${asked.join("\n    ")}
  }
}
${PULL}`;
  return { query, fields: ["-f", `query=${query}`, ...fields] };
}

/** Reads what one repository holds of what is asked, or says what stood
    in the way, or that the repository is not there. A pull request that
    is not there is left out of the answer; the rest still comes. */
export async function readRepo(
  run: Gh,
  ask: Ask,
): Promise<Read | { trouble: Trouble } | { gone: true }> {
  const { fields } = queryOf(ask);
  let answer;
  try {
    answer = await run(["api", "graphql", "--hostname", ask.host, ...fields], {
      host: ask.host,
    });
  } catch (error) {
    if (error instanceof Missing) return { trouble: { kind: "missing" } };
    throw error;
  }
  const parsed = parse(answer.stdout);
  const data = parsed?.data;
  if (!isObject(data) || !isObject(data.repository)) {
    if (parsed !== null && gone(parsed)) return { gone: true };
    const trouble = troubleOf(
      answer.code === 0 ? { ...answer, code: 1 } : answer,
      ask.host,
    ) ?? { kind: "failed", host: ask.host, text: "gh answered nothing" };
    if (trouble.kind === "failed" && parsed !== null) {
      const said = messages(parsed);
      if (/rate limit/i.test(said)) {
        return { trouble: { kind: "limited", host: ask.host, until: null } };
      }
      if (said !== "") return { trouble: { ...trouble, text: said } };
    }
    if (trouble.kind === "limited") {
      return { trouble: { ...trouble, until: rateOf(data)?.resetAt ?? null } };
    }
    return { trouble };
  }
  return readOf(ask, data);
}

/** What one repository's answer holds. */
export function readOf(ask: Ask, data: Record<string, unknown>): Read {
  const repository = data.repository as Record<string, unknown>;
  const repo: Repo = { host: ask.host, owner: ask.owner, name: ask.name };
  const pulls = new Map<string, Pull>();
  const branches = new Map<string, string[]>();
  const numbers = [...new Set(ask.numbers)].filter(
    (n) => Number.isSafeInteger(n) && n > 0,
  );
  numbers.forEach((_, at) => {
    const pull = pullOf(repo, repository[`n${at}`]);
    if (pull !== null) pulls.set(pull.key, pull);
  });
  [...new Set(ask.branches)].forEach((branch, at) => {
    const found = repository[`b${at}`];
    const nodes =
      isObject(found) && Array.isArray(found.nodes) ? found.nodes : [];
    const keys: string[] = [];
    for (const node of nodes) {
      const pull = pullOf(repo, node);
      if (pull === null) continue;
      pulls.set(pull.key, pull);
      keys.push(pull.key);
    }
    branches.set(branch, keys);
  });
  const viewer = isObject(data.viewer) ? text(data.viewer.login) : null;
  return {
    repo,
    rights: rightsOf(repository),
    pulls,
    branches,
    viewer: viewer === "" ? null : viewer,
    rate: rateOf(data),
  };
}

function rightsOf(repository: Record<string, unknown>): Rights {
  const permission = text(repository.viewerPermission) || null;
  const allowed: Rights["method"][] = [];
  if (repository.mergeCommitAllowed === true) allowed.push("merge");
  if (repository.squashMergeAllowed === true) allowed.push("squash");
  if (repository.rebaseMergeAllowed === true) allowed.push("rebase");
  const preferred = text(repository.viewerDefaultMergeMethod).toLowerCase();
  const method =
    (allowed.find((one) => one === preferred) ?? allowed[0]) || null;
  return { permission, method };
}

function rateOf(data: unknown): Read["rate"] {
  if (!isObject(data) || !isObject(data.rateLimit)) return null;
  const remaining = data.rateLimit.remaining;
  const resetAt = Date.parse(text(data.rateLimit.resetAt));
  if (typeof remaining !== "number" || Number.isNaN(resetAt)) return null;
  return { remaining, resetAt };
}

/** A pull request from the query's answer, or null when there is none. */
export function pullOf(repo: Repo, node: unknown): Pull | null {
  if (!isObject(node)) return null;
  const number = node.number;
  const url = text(node.url);
  if (typeof number !== "number" || url === "") return null;
  const state = text(node.state);
  const ref: PullRef = { ...repo, number };
  const head = isObject(node.headRepository) ? node.headRepository : null;
  const headOwner = head && isObject(head.owner) ? text(head.owner.login) : "";
  const closed = Date.parse(text(node.mergedAt) || text(node.closedAt));
  return {
    ...ref,
    key: pullKey(ref),
    title: text(node.title),
    url,
    state: state === "MERGED" || state === "CLOSED" ? state : "OPEN",
    draft: node.isDraft === true,
    head: text(node.headRefName),
    headOid: text(node.headRefOid),
    headRepo:
      head !== null && headOwner !== "" && text(head.name) !== ""
        ? { host: repo.host, owner: headOwner, name: text(head.name) }
        : null,
    base: text(node.baseRefName),
    mergeable:
      node.mergeable === "MERGEABLE" || node.mergeable === "CONFLICTING"
        ? node.mergeable
        : "UNKNOWN",
    mergeState: text(node.mergeStateStatus) || "UNKNOWN",
    decision:
      node.reviewDecision === "APPROVED" ||
      node.reviewDecision === "CHANGES_REQUESTED" ||
      node.reviewDecision === "REVIEW_REQUIRED"
        ? node.reviewDecision
        : null,
    checks: checksOf(node.commits),
    reviews: reviewsOf(node.latestReviews),
    asked: askedOf(node.reviewRequests),
    closedAt: Number.isNaN(closed) ? null : closed,
  };
}

/** gh's buckets for a check's conclusion or state. */
export function bucketOf(state: string): Bucket {
  switch (state) {
    case "SUCCESS":
      return "pass";
    case "SKIPPED":
    case "NEUTRAL":
      return "skipping";
    case "ERROR":
    case "FAILURE":
    case "CANCELLED":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "fail";
    default:
      return "pending";
  }
}

/** The head commit's checks, one per name, the newest of each. A check
    run that has not started yet is newer than any that has. Past the
    first CHECKS, GitHub's state of them all stands in for the rest. */
function checksOf(commits: unknown): Check[] {
  const rollup = path(commits, ["nodes", 0, "commit", "statusCheckRollup"]);
  const contexts = path(rollup, ["contexts", "nodes"]);
  if (!Array.isArray(contexts)) return [];
  const newest = new Map<string, { at: number; check: Check }>();
  for (const context of contexts) {
    if (!isObject(context)) continue;
    let name: string;
    let state: string;
    let at: number;
    if (context.__typename === "CheckRun") {
      const workflow = text(
        path(context, ["checkSuite", "workflowRun", "workflow", "name"]),
      );
      name =
        workflow === ""
          ? text(context.name)
          : `${workflow} / ${text(context.name)}`;
      state =
        context.status === "COMPLETED"
          ? text(context.conclusion)
          : text(context.status);
      at = Date.parse(text(context.startedAt)) || Number.POSITIVE_INFINITY;
    } else if (context.__typename === "StatusContext") {
      name = text(context.context);
      state = text(context.state);
      at = Date.parse(text(context.createdAt)) || 0;
    } else {
      continue;
    }
    if (name === "") continue;
    const had = newest.get(name);
    if (had !== undefined && had.at > at) continue;
    newest.set(name, { at, check: { name, bucket: bucketOf(state) } });
  }
  const checks = [...newest.values()].map((one) => one.check);
  const total = path(rollup, ["contexts", "totalCount"]);
  if (typeof total !== "number" || total <= contexts.length) return checks;
  const all = text(path(rollup, ["state"]));
  const any = (...buckets: Bucket[]): boolean =>
    checks.some((check) => buckets.includes(check.bucket));
  if ((all === "FAILURE" || all === "ERROR") && !any("fail")) {
    checks.push({ name: UNREAD, bucket: "fail" });
  } else if ((all === "PENDING" || all === "EXPECTED") && !any("pending")) {
    checks.push({ name: UNREAD, bucket: "pending" });
  }
  return checks;
}

function reviewsOf(latest: unknown): Review[] {
  const nodes = path(latest, ["nodes"]);
  if (!Array.isArray(nodes)) return [];
  const reviews: Review[] = [];
  for (const node of nodes) {
    if (!isObject(node) || !isObject(node.author)) continue;
    const login = text(node.author.login);
    if (login === "") continue;
    reviews.push({
      login,
      who: text(node.author.name) || login,
      state: text(node.state),
      at: Date.parse(text(node.submittedAt)) || 0,
    });
  }
  return reviews;
}

function askedOf(requests: unknown): string[] {
  const nodes = path(requests, ["nodes"]);
  if (!Array.isArray(nodes)) return [];
  const asked: string[] = [];
  for (const node of nodes) {
    const reviewer = path(node, ["requestedReviewer"]);
    if (!isObject(reviewer)) continue;
    const name = text(reviewer.name) || text(reviewer.login);
    if (name !== "") asked.push(name);
  }
  return asked;
}

/** Whether an answer says the repository itself is not there. */
function gone(answer: Record<string, unknown>): boolean {
  if (!Array.isArray(answer.errors)) return false;
  return answer.errors.some(
    (error) =>
      isObject(error) &&
      error.type === "NOT_FOUND" &&
      Array.isArray(error.path) &&
      error.path[0] === "repository",
  );
}

/** What the errors of an answer say, as one line. */
function messages(answer: Record<string, unknown>): string {
  if (!Array.isArray(answer.errors)) return "";
  return answer.errors
    .map((error) => (isObject(error) ? text(error.message) : ""))
    .filter((message) => message !== "")
    .join("; ");
}

function parse(stdout: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(stdout);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function path(value: unknown, steps: (string | number)[]): unknown {
  let at = value;
  for (const step of steps) {
    if (typeof step === "number") {
      if (!Array.isArray(at)) return undefined;
      at = at[step];
    } else {
      if (!isObject(at)) return undefined;
      at = at[step];
    }
  }
  return at;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The repositories to read, one ask each, from the pull requests and the
    branches wanted. */
export function asksOf(
  refs: PullRef[],
  branches: { repo: Repo; branch: string }[],
): Ask[] {
  const asks = new Map<string, Ask>();
  const askOf = (repo: Repo): Ask => {
    const key = repoKey(repo);
    let ask = asks.get(key);
    if (ask === undefined) {
      ask = {
        host: repo.host,
        owner: repo.owner,
        name: repo.name,
        numbers: [],
        branches: [],
      };
      asks.set(key, ask);
    }
    return ask;
  };
  for (const ref of refs) {
    const ask = askOf(ref);
    if (!ask.numbers.includes(ref.number)) ask.numbers.push(ref.number);
  }
  for (const { repo, branch } of branches) {
    const ask = askOf(repo);
    if (!ask.branches.includes(branch)) ask.branches.push(branch);
  }
  return [...asks.values()];
}
