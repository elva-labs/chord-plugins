/**
 * When to read again. While an open pull request is watched, a read
 * follows the last one after a minute, half as long again each time
 * nothing changed, up to five minutes. A change, a heard command or the
 * Refresh action reads at once and starts again from a minute. A rate
 * limit waits until the limit lifts, or longer each time when GitHub does
 * not say when. With nothing open to watch, no timer runs at all.
 */

/** Time, as the schedule sees it; a test hands it one it moves itself. */
export interface Clock {
  now(): number;
  /** Calls `fn` after `ms`, and answers with what cancels it. */
  after(ms: number, fn: () => void): () => void;
}

/** The clock of the world, whose timers never keep the process alive. */
export const clock: Clock = {
  now: () => Date.now(),
  after(ms, fn) {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

/** What a read found, as the schedule needs it. */
export interface Outcome {
  /** Whether an open pull request is watched. */
  watching: boolean;
  /** Whether anything shown changed. */
  changed: boolean;
  /** Whether a host's rate limit stood in the way, and until when, in
      milliseconds since the epoch, when GitHub said. */
  limited: boolean;
  until: number | null;
}

export const BASE_MS = 60_000;
export const MAX_MS = 5 * 60_000;
export const GROWTH = 1.5;
export const LIMITED_MS = 5 * 60_000;
export const LIMITED_MAX_MS = 30 * 60_000;

/** Reads on a timer, and at once when asked, one read at a time. */
export class Schedule {
  readonly #clock: Clock;
  readonly #read: () => Promise<Outcome>;
  #delay = BASE_MS;
  #limitedDelay = LIMITED_MS;
  #cancel: (() => void) | null = null;
  #running: Promise<void> | null = null;
  #again = false;
  /** When the next read is due, or null when none is. */
  next: number | null = null;

  constructor(clock: Clock, read: () => Promise<Outcome>) {
    this.#clock = clock;
    this.#read = read;
  }

  /** Reads at once and starts the waits again from a minute. A read
      already running is followed by one more. */
  now(): Promise<void> {
    this.#delay = BASE_MS;
    this.#stop();
    if (this.#running !== null) {
      this.#again = true;
      return this.#running;
    }
    this.#running = this.#loop().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /** Stops the timer. */
  stop(): void {
    this.#stop();
  }

  async #loop(): Promise<void> {
    let outcome: Outcome;
    do {
      this.#again = false;
      try {
        outcome = await this.#read();
      } catch {
        outcome = {
          watching: true,
          changed: false,
          limited: false,
          until: null,
        };
      }
    } while (this.#again);
    this.#plan(outcome);
  }

  #plan(outcome: Outcome): void {
    let wait: number;
    if (outcome.limited) {
      const now = this.#clock.now();
      if (outcome.until !== null && outcome.until > now) {
        wait = Math.min(outcome.until - now + 1_000, LIMITED_MAX_MS);
        this.#limitedDelay = LIMITED_MS;
      } else {
        wait = this.#limitedDelay;
        this.#limitedDelay = Math.min(this.#limitedDelay * 2, LIMITED_MAX_MS);
      }
      this.#delay = BASE_MS;
    } else {
      this.#limitedDelay = LIMITED_MS;
      if (!outcome.watching) {
        this.#delay = BASE_MS;
        return;
      }
      if (outcome.changed) this.#delay = BASE_MS;
      wait = this.#delay;
      this.#delay = Math.min(this.#delay * GROWTH, MAX_MS);
    }
    this.next = this.#clock.now() + wait;
    this.#cancel = this.#clock.after(wait, () => {
      this.#cancel = null;
      this.next = null;
      if (this.#running !== null) return;
      this.#running = this.#loop().finally(() => {
        this.#running = null;
      });
    });
  }

  #stop(): void {
    this.#cancel?.();
    this.#cancel = null;
    this.next = null;
  }
}
