import { expect, it } from "vitest";
import { FakeClock, settle } from "./fake.test-helper.js";
import { BASE_MS, MAX_MS, Schedule, type Outcome } from "./schedule.js";

const QUIET: Outcome = { watching: true, changed: false, wake: null };

/** A schedule whose reads answer from a list, the last answer repeating,
    and the times it read at. */
function scheduled(outcomes: Outcome[]) {
  const clock = new FakeClock();
  const reads: number[] = [];
  let at = 0;
  const schedule = new Schedule(clock, async () => {
    reads.push(clock.now());
    const outcome = outcomes[Math.min(at, outcomes.length - 1)] as Outcome;
    at++;
    return outcome;
  });
  const gaps = () =>
    reads.slice(1).map((time, i) => time - (reads[i] as number));
  return { clock, schedule, reads, gaps };
}

it("reads again after a minute, half as long again each quiet time, up to five minutes", async () => {
  const { clock, schedule, gaps } = scheduled([QUIET]);

  await schedule.now();
  await clock.move(30 * 60_000);

  expect(gaps().slice(0, 6)).toEqual([
    BASE_MS,
    BASE_MS * 1.5,
    BASE_MS * 2.25,
    BASE_MS * 3.375,
    MAX_MS,
    MAX_MS,
  ]);
  expect(clock.waiting).toBe(1);
});

it("starts again from a minute when something changed", async () => {
  const { clock, schedule, gaps } = scheduled([
    QUIET,
    QUIET,
    QUIET,
    { ...QUIET, changed: true },
    QUIET,
  ]);

  await schedule.now();
  await clock.move(
    BASE_MS + BASE_MS * 1.5 + BASE_MS * 2.25 + BASE_MS + BASE_MS * 1.5,
  );

  expect(gaps()).toEqual([
    BASE_MS,
    BASE_MS * 1.5,
    BASE_MS * 2.25,
    BASE_MS,
    BASE_MS * 1.5,
  ]);
});

it("runs no timer while nothing open is watched, and starts when asked", async () => {
  const { clock, schedule, reads } = scheduled([
    { ...QUIET, watching: false },
    QUIET,
  ]);

  await schedule.now();
  expect(clock.waiting).toBe(0);
  expect(schedule.next).toBeNull();
  await clock.move(60 * 60_000);
  expect(reads).toHaveLength(1);

  await schedule.now();
  expect(reads).toHaveLength(2);
  expect(schedule.next).toBe(clock.now() + BASE_MS);
});

it("reads at once when asked, and waits a minute after that", async () => {
  const { clock, schedule, reads } = scheduled([QUIET]);

  await schedule.now();
  await clock.move(BASE_MS + BASE_MS * 1.5);
  await clock.move(10_000);
  await schedule.now();

  expect(reads).toHaveLength(4);
  expect(clock.waiting).toBe(1);
  expect(clock.next).toBe(clock.now() + BASE_MS);
});

it("reads when a waiting host's limit lifts, sooner than the timer would", async () => {
  const { clock, schedule, reads } = scheduled([
    { ...QUIET, wake: Date.parse("2026-11-20T10:30:20Z") },
    QUIET,
  ]);

  await schedule.now();

  expect(clock.next).toBe(Date.parse("2026-11-20T10:30:20Z"));
  await clock.move(20_000);
  expect(reads).toHaveLength(2);
});

it("keeps to the timer while a waiting host's limit lifts later", async () => {
  const { clock, schedule } = scheduled([
    { ...QUIET, wake: Date.parse("2026-11-20T11:00:00Z") },
  ]);

  await schedule.now();

  expect(clock.next).toBe(clock.now() + BASE_MS);
});

it("reads when a host's limit lifts though nothing open is watched", async () => {
  const { clock, schedule, reads } = scheduled([
    {
      watching: false,
      changed: false,
      wake: Date.parse("2026-11-20T10:42:00Z"),
    },
    { ...QUIET, watching: false },
  ]);

  await schedule.now();

  expect(clock.next).toBe(Date.parse("2026-11-20T10:42:00Z"));
  await clock.move(12 * 60_000);
  expect(reads).toHaveLength(2);
  expect(clock.waiting).toBe(0);
});

it("reads once more after a read that was running when asked", async () => {
  const clock = new FakeClock();
  let reads = 0;
  let release: () => void = () => {};
  const schedule = new Schedule(clock, async () => {
    reads++;
    if (reads === 1) await new Promise<void>((resolve) => (release = resolve));
    return QUIET;
  });

  const first = schedule.now();
  await settle();
  const second = schedule.now();
  const third = schedule.now();
  expect(reads).toBe(1);
  release();
  await Promise.all([first, second, third]);

  expect(reads).toBe(2);
  expect(clock.waiting).toBe(1);
});

it("keeps watching after a read that threw", async () => {
  const clock = new FakeClock();
  const schedule = new Schedule(clock, async () => {
    throw new Error("broken");
  });

  await schedule.now();

  expect(clock.next).toBe(clock.now() + BASE_MS);
});

it("stops its timer when told to", async () => {
  const { clock, schedule, reads } = scheduled([QUIET]);

  await schedule.now();
  schedule.stop();
  await clock.move(10 * 60_000);

  expect(reads).toHaveLength(1);
  expect(clock.waiting).toBe(0);
  expect(schedule.next).toBeNull();
});
