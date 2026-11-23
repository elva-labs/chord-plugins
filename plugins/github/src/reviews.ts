/**
 * Which session reviewed which pull request, kept on disk by the pull
 * request's key so a re-review can go back to it after the plugin and the
 * app have restarted. A session the plugin starts for a review carries the
 * ref `review:<key>`, which the app hands back on that session's lines and
 * keeps across resumes. The file is bounded: a record a month old goes,
 * and past a cap the oldest go first.
 */

import { readFile } from "node:fs/promises";
import { file, writeWhole } from "./store.js";

/** How many records are kept. */
export const MAX_REVIEWS = 200;
/** How long a record is kept after it was last given work. */
export const KEPT_REVIEW_MS = 30 * 24 * 60 * 60 * 1000;

const REF = "review:";

/** The ref a review of a pull request starts with. */
export function refOf(key: string): string {
  return `${REF}${key}`;
}

/** The pull request's key a ref names, or null for a ref that is not a
    review's. */
export function keyOfRef(ref: string | undefined): string | null {
  return ref?.startsWith(REF) === true && ref.length > REF.length
    ? ref.slice(REF.length)
    : null;
}

/** The session that reviewed a pull request. */
export interface Reviewer {
  session: string;
  project: string;
  /** When it was last given the review, a start or a line sent. */
  at: number;
  /** Whether the session is running now. */
  live: boolean;
}

/** The sessions that reviewed, by pull request, in memory and on disk. */
export class Reviews {
  readonly #file: string;
  #kept = new Map<string, Reviewer>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string = file("reviews.json")) {
    this.#file = path;
  }

  /** Reads the file; one that is missing or is not what it should be
      reads as no records. A session read from it is not running until the
      app says it is. */
  async load(now: number): Promise<void> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(this.#file, "utf8"));
    } catch {
      return;
    }
    const reviews =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>).reviews
        : null;
    if (typeof reviews !== "object" || reviews === null) return;
    for (const [key, kept] of Object.entries(reviews)) {
      if (typeof kept !== "object" || kept === null) continue;
      const one = kept as Record<string, unknown>;
      if (typeof one.session !== "string" || one.session === "") continue;
      if (typeof one.project !== "string" || typeof one.at !== "number") {
        continue;
      }
      this.#kept.set(key, {
        session: one.session,
        project: one.project,
        at: one.at,
        live: false,
      });
    }
    this.prune(now);
  }

  /** The session that reviewed a pull request, or null. */
  of(key: string): Reviewer | null {
    return this.#kept.get(key) ?? null;
  }

  /** The pull requests a session reviews, by key. */
  keysOf(session: string): string[] {
    return [...this.#kept]
      .filter(([, kept]) => kept.session === session)
      .map(([key]) => key);
  }

  /** A session started or resumed for a review. Answers whether anything
      changed. */
  started(key: string, session: string, project: string, now: number): boolean {
    const had = this.#kept.get(key);
    if (had?.session === session) {
      if (had.live) return false;
      had.live = true;
      return true;
    }
    this.#kept.set(key, { session, project, at: now, live: true });
    this.prune(now);
    return true;
  }

  /** A session ended or was put away. Answers whether it reviewed
      anything. */
  ended(session: string): boolean {
    let changed = false;
    for (const kept of this.#kept.values()) {
      if (kept.session !== session || !kept.live) continue;
      kept.live = false;
      changed = true;
    }
    return changed;
  }

  /** The session that reviewed a pull request has the review again. */
  given(key: string, now: number): void {
    const kept = this.#kept.get(key);
    if (kept === undefined) return;
    kept.at = now;
    kept.live = true;
  }

  /** The session that reviewed a pull request will not come back. */
  drop(key: string): void {
    this.#kept.delete(key);
  }

  /** Lets go of what is past keeping. */
  prune(now: number): void {
    for (const [key, kept] of this.#kept) {
      if (now - kept.at >= KEPT_REVIEW_MS) this.#kept.delete(key);
    }
    if (this.#kept.size <= MAX_REVIEWS) return;
    const newest = [...this.#kept].sort((a, b) => b[1].at - a[1].at);
    this.#kept = new Map(newest.slice(0, MAX_REVIEWS));
  }

  /** Writes the records, after any write already on its way. */
  save(): Promise<void> {
    const reviews = Object.fromEntries(
      [...this.#kept].map(([key, { session, project, at }]) => [
        key,
        { session, project, at },
      ]),
    );
    const text = `${JSON.stringify({ version: 1, reviews }, null, 2)}\n`;
    const write = (): Promise<void> => writeWhole(this.#file, text);
    const next = this.#queue.then(write, write);
    this.#queue = next.catch(() => undefined);
    return next;
  }
}
