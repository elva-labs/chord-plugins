/**
 * The signed-in user's own open pull requests in one repository, newest
 * first: one search through `gh api graphql`. Titles and reviewers' names
 * come out of here as plain words, as the reviews asked do.
 */

import { urlOf, type Repo } from "./address.js";
import { Missing, type Gh, type Trouble } from "./gh.js";
import {
  failedOf,
  isObject,
  parse,
  path,
  PULL,
  pullOf,
  rateOf,
  type Pull,
  type Read,
} from "./pulls.js";
import { named, plain, TITLE_MAX } from "./requests.js";

/** How many of the user's pull requests are read in a repository. */
export const MAX_MINE = 30;

/** What one repository's search answered. */
export interface Mine {
  pulls: Pull[];
  rate: Read["rate"];
}

const QUERY = `query($q: String!) {
  rateLimit { remaining resetAt }
  search(type: ISSUE, query: $q, first: ${MAX_MINE}) { nodes { ...pull } }
}
${PULL}`;

/** The arguments of the search's call to gh. */
export function mineArgs(repo: Repo): string[] {
  return [
    "api",
    "graphql",
    "--hostname",
    repo.host,
    "-f",
    `query=${QUERY}`,
    "-f",
    `q=is:pr is:open author:@me repo:${repo.owner}/${repo.name} sort:created-desc`,
  ];
}

/** Reads the user's open pull requests in a repository, or says what stood
    in the way. */
export async function readMine(
  run: Gh,
  repo: Repo,
): Promise<Mine | { trouble: Trouble }> {
  let answer;
  try {
    answer = await run(mineArgs(repo), { host: repo.host });
  } catch (error) {
    if (error instanceof Missing) return { trouble: { kind: "missing" } };
    throw error;
  }
  const parsed = parse(answer.stdout);
  const data = parsed?.data;
  if (!isObject(data) || !isObject(data.search)) {
    return { trouble: failedOf(answer, parsed, repo.host) };
  }
  const nodes = path(data, ["search", "nodes"]);
  const pulls: Pull[] = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const pull = pullOf(repo, node);
    if (pull === null) continue;
    pulls.push({
      ...pull,
      title: plain(pull.title, TITLE_MAX) || `#${pull.number}`,
      url: urlOf(pull),
      reviews: pull.reviews.map((one) => ({ ...one, who: named(one.who) })),
      asked: pull.asked.map(named).filter(Boolean),
    });
  }
  return { pulls, rate: rateOf(data) };
}
