/**
 * The claims, kept on disk by agent session id so a session's pull
 * requests outlast the plugin and the app. The file is bounded: a session
 * unseen for a month goes, so does a pull request merged or closed a few
 * days ago, and past a cap the oldest go first. Writes go one at a time,
 * each written beside the file and moved into place.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { KEPT_CLOSED_MS } from "./mapping.js";

/** The environment variable that moves the file somewhere other than the
    home directory. */
export const HOME = "WORKBENCH_GITHUB_HOME";

/** Where the claims are kept. */
export function file(): string {
  const said = process.env[HOME];
  const home = said !== undefined && said !== "" ? said : homedir();
  return join(home, ".agent-workbench", "plugins", "github", "sessions.json");
}

/** How many sessions are kept. */
export const MAX_SESSIONS = 200;
/** How many pull requests a session keeps. */
export const MAX_PULLS = 50;
/** How long a session is kept after it was last seen. */
export const KEPT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

interface Claim {
  key: string;
  /** When it was claimed. */
  at: number;
  /** When it was seen merged or closed. */
  closed: number | null;
}

interface Kept {
  /** When the session was last seen. */
  seen: number;
  pulls: Claim[];
}

/** The claims of every session, in memory and on disk. */
export class Store {
  readonly #file: string;
  #sessions = new Map<string, Kept>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string = file()) {
    this.#file = path;
  }

  /** Reads the file; a file that is missing or is not what it should be
      reads as no claims at all. */
  async load(now: number): Promise<void> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(this.#file, "utf8"));
    } catch {
      return;
    }
    const sessions =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>).sessions
        : null;
    if (typeof sessions !== "object" || sessions === null) return;
    for (const [id, kept] of Object.entries(sessions)) {
      const sound = soundKept(kept);
      if (sound !== null) this.#sessions.set(id, sound);
    }
    this.prune(now);
  }

  /** The pull requests each session claimed, newest first. */
  claims(): Map<string, string[]> {
    const claims = new Map<string, string[]>();
    for (const [id, kept] of this.#sessions) {
      claims.set(
        id,
        [...kept.pulls].sort((a, b) => b.at - a.at).map((claim) => claim.key),
      );
    }
    return claims;
  }

  /**
   * Gives a pull request to a session. One another session holds moves
   * only when `take` is true; otherwise it stays. Answers whether
   * anything changed.
   */
  claim(id: string, key: string, now: number, take: boolean): boolean {
    for (const [other, kept] of this.#sessions) {
      if (!kept.pulls.some((claim) => claim.key === key)) continue;
      if (other === id) return false;
      if (!take) return false;
      kept.pulls = kept.pulls.filter((claim) => claim.key !== key);
      if (kept.pulls.length === 0) this.#sessions.delete(other);
    }
    const kept = this.#sessions.get(id) ?? { seen: now, pulls: [] };
    kept.seen = now;
    kept.pulls.push({ key, at: now, closed: null });
    this.#sessions.set(id, kept);
    this.prune(now);
    return true;
  }

  /** Notes that a session is still about. */
  seen(id: string, now: number): void {
    const kept = this.#sessions.get(id);
    if (kept !== undefined) kept.seen = now;
  }

  /** Notes when a claimed pull request was merged or closed, or that it
      is open again. Answers whether anything changed. */
  closed(key: string, at: number | null): boolean {
    let changed = false;
    for (const kept of this.#sessions.values()) {
      for (const claim of kept.pulls) {
        if (claim.key !== key || claim.closed === at) continue;
        claim.closed = at;
        changed = true;
      }
    }
    return changed;
  }

  /** Lets go of every claim in a repository, by its `repoKey`. Answers
      whether anything changed. */
  forget(repo: string): boolean {
    let changed = false;
    for (const [id, kept] of this.#sessions) {
      const left = kept.pulls.filter(
        (claim) => !claim.key.startsWith(`${repo}#`),
      );
      if (left.length === kept.pulls.length) continue;
      changed = true;
      kept.pulls = left;
      if (left.length === 0) this.#sessions.delete(id);
    }
    return changed;
  }

  /** Lets go of what is past keeping. */
  prune(now: number): void {
    for (const [id, kept] of this.#sessions) {
      kept.pulls = kept.pulls
        .filter(
          (claim) =>
            claim.closed === null || now - claim.closed < KEPT_CLOSED_MS,
        )
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_PULLS);
      if (kept.pulls.length === 0 || now - kept.seen >= KEPT_SESSION_MS) {
        this.#sessions.delete(id);
      }
    }
    if (this.#sessions.size <= MAX_SESSIONS) return;
    const newest = [...this.#sessions].sort((a, b) => b[1].seen - a[1].seen);
    this.#sessions = new Map(newest.slice(0, MAX_SESSIONS));
  }

  /** Writes the claims, after any write already on its way. */
  save(): Promise<void> {
    const text = `${JSON.stringify(
      { version: 1, sessions: Object.fromEntries(this.#sessions) },
      null,
      2,
    )}\n`;
    const next = this.#queue.then(
      () => this.#write(text),
      () => this.#write(text),
    );
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #write(text: string): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true });
    const beside = `${this.#file}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(beside, text, "utf8");
    await rename(beside, this.#file);
  }
}

function soundKept(value: unknown): Kept | null {
  if (typeof value !== "object" || value === null) return null;
  const kept = value as Record<string, unknown>;
  if (typeof kept.seen !== "number" || !Array.isArray(kept.pulls)) return null;
  const pulls: Claim[] = [];
  for (const claim of kept.pulls) {
    if (typeof claim !== "object" || claim === null) continue;
    const one = claim as Record<string, unknown>;
    if (typeof one.key !== "string" || typeof one.at !== "number") continue;
    pulls.push({
      key: one.key,
      at: one.at,
      closed: typeof one.closed === "number" ? one.closed : null,
    });
  }
  return { seen: kept.seen, pulls };
}
