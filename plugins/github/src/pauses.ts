/**
 * The hosts left alone for a rate limit, shared by everything that reads
 * GitHub, since a limit is the host's and not one reader's. A Refresh or
 * Try again from any reader lifts the pause for every reader.
 */

/** How long a host is left alone the first time it is rate limited
    without saying until when; each time after, twice as long. */
export const LIMITED_MS = 5 * 60_000;
/** The longest a host is left alone for a rate limit. */
export const LIMITED_MAX_MS = 30 * 60_000;

/** A host left alone: until when, and how long to wait the next time it
    is limited without saying until when. */
interface Pause {
  until: number;
  next: number;
}

export class Pauses {
  readonly #paused = new Map<string, Pause>();

  /** Until when a host is left alone, or null when it is not. */
  until(host: string, now: number): number | null {
    const pause = this.#paused.get(host);
    return pause !== undefined && pause.until > now ? pause.until : null;
  }

  /** Leaves a host alone until its rate limit lifts: until a second after
      the time GitHub gave, or for longer each time it gave none, at most
      LIMITED_MAX_MS. Answers until when. */
  pause(host: string, until: number | null, now: number): number {
    const before = this.#paused.get(host);
    let pause: Pause;
    if (until !== null && until > now) {
      pause = {
        until: Math.min(until + 1_000, now + LIMITED_MAX_MS),
        next: LIMITED_MS,
      };
    } else {
      const wait = before?.next ?? LIMITED_MS;
      pause = {
        until: now + wait,
        next: Math.min(wait * 2, LIMITED_MAX_MS),
      };
    }
    this.#paused.set(host, pause);
    return pause.until;
  }

  /** A host answered well and is not limited. */
  lift(host: string): void {
    this.#paused.delete(host);
  }

  /** Every host is read again. */
  clear(): void {
    this.#paused.clear();
  }

  /** When each pause still running ends. */
  ends(now: number): number[] {
    return [...this.#paused.values()]
      .map((pause) => pause.until)
      .filter((until) => until > now);
  }
}
