/**
 * What is worth a line on a session's row: checks that fail, checks that
 * pass after failing, a review given, and a pull request merged or closed.
 * Each change is told once. What a pull request was the first time it is
 * seen is only remembered, never told.
 */

import { checksOf } from "./standing.js";
import type { Pull } from "./pulls.js";

/** What was last seen of a pull request. */
export interface Seen {
  state: Pull["state"];
  head: string;
  /** How the head's checks stood: failed, passed, running, or none. */
  checks: "fail" | "pass" | "pending" | "none";
  /** How the checks last stood once they were done, on any head. */
  settled: "fail" | "pass" | null;
  /** The reviews already told of, as login and time. */
  reviews: string[];
}

const TOLD = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]);

/** Takes in what a pull request is now, and answers with what to remember
    and the lines to tell. The signed-in user's own reviews are never
    told. */
export function notice(
  before: Seen | undefined,
  pull: Pull,
  viewer: string | null,
): { seen: Seen; lines: string[] } {
  const checks = checksOf(pull);
  const now: Seen["checks"] =
    checks.state === "failed"
      ? "fail"
      : checks.state === "busy"
        ? "pending"
        : checks.state === "ok"
          ? "pass"
          : "none";
  const reviews = pull.reviews.filter(
    (review) => TOLD.has(review.state) && review.login !== viewer,
  );
  const seen: Seen = {
    state: pull.state,
    head: pull.headOid,
    checks: now,
    settled: now === "fail" || now === "pass" ? now : (before?.settled ?? null),
    reviews: reviews.map(reviewKey),
  };
  if (before === undefined) return { seen, lines: [] };

  const lines: string[] = [];
  const tag = `#${pull.number}`;
  if (before.state === "OPEN" && pull.state === "MERGED") {
    lines.push(`${tag} merged into ${pull.base}`);
  } else if (before.state === "OPEN" && pull.state === "CLOSED") {
    lines.push(`${tag} closed`);
  }
  if (pull.state === "OPEN") {
    if (
      now === "fail" &&
      (before.checks !== "fail" || before.head !== pull.headOid)
    ) {
      const [first, ...rest] = checks.failed;
      lines.push(
        rest.length === 0
          ? `${tag} check failed: ${first}`
          : `${tag} ${checks.failed.length} checks failed`,
      );
    }
    if (
      now === "pass" &&
      before.checks !== "pass" &&
      before.settled === "fail"
    ) {
      lines.push(`${tag} checks pass again`);
    }
    const told = new Set(before.reviews);
    for (const review of reviews) {
      if (told.has(reviewKey(review))) continue;
      lines.push(
        review.state === "APPROVED"
          ? `${tag} approved by ${review.who}`
          : review.state === "CHANGES_REQUESTED"
            ? `${tag} changes requested by ${review.who}`
            : `${tag} reviewed by ${review.who}`,
      );
    }
  }
  return { seen, lines };
}

function reviewKey(review: Pull["reviews"][number]): string {
  return `${review.login}@${review.at}`;
}
