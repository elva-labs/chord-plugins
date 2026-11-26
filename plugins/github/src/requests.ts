/**
 * The open pull requests whose authors asked the signed-in user by name for
 * a review, on one host: one search through `gh api graphql`. What GitHub
 * says of them, titles and names most of all, is someone else's text, so
 * it comes out of here as plain words of bounded length that carry no
 * line breaks, no control characters and no quotes or backticks that could
 * close the ones a prompt puts around them.
 */

import { pullKey, urlOf, type PullRef } from "./address.js";
import { Missing, type Gh, type Trouble } from "./gh.js";
import {
  checksIn,
  failedOf,
  HEAD_CHECKS,
  isObject,
  parse,
  path,
  rateOf,
  text,
  type Check,
  type Read,
} from "./pulls.js";

/** A pull request whose author asked the user for a review. */
export interface Asked extends PullRef {
  key: string;
  /** Its title, as plain words. */
  title: string;
  url: string;
  /** Its author's name, or login when they gave none, as plain words. */
  author: string;
  /** When it was opened, in milliseconds since the epoch. */
  at: number;
  draft: boolean;
  /** Whether its head is in another repository than its base, a fork,
      or GitHub did not say. */
  fork: boolean;
  checks: Check[];
  /** When the user last submitted a review of it, or null when they have
      not. A review asked of someone who gave one is asked again. */
  reviewed: number | null;
}

/** What one host's search answered. */
export interface Asks {
  host: string;
  asks: Asked[];
  /** The signed-in user's login. */
  viewer: string | null;
  rate: Read["rate"];
}

/** How many asks are read on one host. */
export const MAX_ASKS = 30;

/** The search: open pull requests that ask the user by name, not through
    a team, outside archived repositories. */
export const SEARCH = "is:pr is:open user-review-requested:@me archived:false";

/** The longest a title is kept, in characters. */
export const TITLE_MAX = 120;
/** The longest a name is kept, in characters. */
export const NAME_MAX = 60;

const QUERY = `query($q: String!) {
  viewer { login }
  rateLimit { remaining resetAt }
  search(type: ISSUE, query: $q, first: ${MAX_ASKS}) {
    nodes { ... on PullRequest {
      number title createdAt isDraft isCrossRepository
      author { login ... on User { name } }
      repository { name owner { login } }
      latestReviews(first: 30) { nodes { state submittedAt author { login } } }
      ${HEAD_CHECKS}
    } }
  }
}`;

/** The arguments of the search's call to gh. */
export function searchArgs(host: string): string[] {
  return [
    "api",
    "graphql",
    "--hostname",
    host,
    "-f",
    `query=${QUERY}`,
    "-f",
    `q=${SEARCH}`,
  ];
}

/** Reads the reviews asked of the user on one host, or says what stood
    in the way. */
export async function readAsks(
  run: Gh,
  host: string,
): Promise<Asks | { trouble: Trouble }> {
  let answer;
  try {
    answer = await run(searchArgs(host), { host });
  } catch (error) {
    if (error instanceof Missing) return { trouble: { kind: "missing" } };
    throw error;
  }
  const parsed = parse(answer.stdout);
  const data = parsed?.data;
  if (!isObject(data) || !isObject(data.search)) {
    return { trouble: failedOf(answer, parsed, host) };
  }
  return asksOf(host, data);
}

/** What one host's answer holds. */
export function asksOf(host: string, data: Record<string, unknown>): Asks {
  const login = isObject(data.viewer) ? text(data.viewer.login) : "";
  const viewer = login === "" ? null : login;
  const nodes = path(data, ["search", "nodes"]);
  const asks = new Map<string, Asked>();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const asked = askedOf(host, viewer, node);
    if (asked !== null) asks.set(asked.key, asked);
  }
  return { host, asks: [...asks.values()], viewer, rate: rateOf(data) };
}

/** The characters an owner's or a repository's name is made of. */
const NAME = /^[A-Za-z0-9_.-]+$/;

/** One pull request of the search, or null for a node that is not one or
    does not name a repository and number this plugin trusts. */
export function askedOf(
  host: string,
  viewer: string | null,
  node: unknown,
): Asked | null {
  if (!isObject(node)) return null;
  const number = node.number;
  const owner = text(path(node, ["repository", "owner", "login"]));
  const name = text(path(node, ["repository", "name"]));
  if (typeof number !== "number" || !Number.isSafeInteger(number)) return null;
  if (number <= 0 || !NAME.test(owner) || !NAME.test(name)) return null;
  if (name === "." || name === "..") return null;
  const ref: PullRef = { host, owner, name, number };
  const author = isObject(node.author) ? node.author : {};
  const opened = Date.parse(text(node.createdAt));
  return {
    ...ref,
    key: pullKey(ref),
    title: plain(text(node.title), TITLE_MAX) || `#${number}`,
    url: urlOf(ref),
    author: named(text(author.name)) || named(text(author.login)) || "Someone",
    at: Number.isNaN(opened) ? 0 : opened,
    draft: node.isDraft === true,
    fork: node.isCrossRepository !== false,
    checks: checksIn(node.commits),
    reviewed: viewer === null ? null : reviewedBy(viewer, node.latestReviews),
  };
}

/** When a login last submitted a review, or null when they have not. */
function reviewedBy(login: string, latest: unknown): number | null {
  const nodes = path(latest, ["nodes"]);
  if (!Array.isArray(nodes)) return null;
  let last: number | null = null;
  for (const node of nodes) {
    if (!isObject(node) || node.state === "PENDING") continue;
    if (text(path(node, ["author", "login"])) !== login) continue;
    const at = Date.parse(text(node.submittedAt));
    if (!Number.isNaN(at) && (last === null || at > last)) last = at;
  }
  return last;
}

/** Characters that never reach the app from someone else's text: control
    and format characters, and line and paragraph separators. */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
/** Quotes and the backtick, which could close the ones put around a
    title or start code in a prompt. */
const QUOTES = /["`‘’‚‛“”„‟«»‹›]/g;

/** Someone else's text as plain words on one line, at most `max`
    characters, cut with "..." when longer. */
export function plain(value: string, max: number): string {
  const words = value
    .replace(UNSEEN, " ")
    .replace(QUOTES, "'")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  const chars = [...words];
  if (chars.length <= max) return words;
  return `${chars
    .slice(0, Math.max(0, max - 3))
    .join("")
    .trimEnd()}...`;
}

/** A person's name as plain words that begin with a letter or a digit. */
export function named(value: string): string {
  return plain(value, NAME_MAX).replace(/^[^\p{L}\p{N}]+/u, "");
}
