/**
 * The plugin at work: the sessions the app told of, the pull requests read
 * for them, and what each session's fold and mark show. A read asks every
 * repository once for what is wanted there, tells what changed on the
 * rows of the sessions whose pull requests they are, and sends again only
 * the folds and marks that changed. gh, git, the file, the clock and the
 * app are all handed in, so a test can stand in for each.
 */

import { tmpdir } from "node:os";
import {
  pullKey,
  pullOfUrl,
  pullUrls,
  refOfKey,
  repoKey,
  wordsOf,
  type PullRef,
  type Repo,
  type Words,
} from "./address.js";
import {
  detailOf,
  headerOf,
  rowsOf,
  type Heard,
  type Line,
  type View,
} from "./app.js";
import {
  Missing,
  said,
  saysSignedOut,
  type Gh,
  type Need,
  type Run,
  type Trouble,
} from "./gh.js";
import {
  branchKey,
  owned,
  owners,
  wanted,
  type Session,
  type World,
} from "./mapping.js";
import { notice, type Seen } from "./notices.js";
import { Pauses } from "./pauses.js";
import { placeOf, type Place, type Remotes } from "./place.js";
import {
  asksOf,
  readRepo,
  type Ask,
  type Pull,
  type Read,
  type Rights,
} from "./pulls.js";
import { Schedule, type Clock, type Outcome } from "./schedule.js";
import { readyToMerge, tallyOf, type Tally } from "./standing.js";
import type { Store } from "./store.js";

/** What the plugin tells the app. */
export interface Out {
  /** Sends a session's fold again. */
  fold(project: string, session: string): void;
  /** Puts the mark on a session's row, or takes it away. */
  mark(project: string, session: string, tally: Tally | null): void;
  /** Puts a line on a session's row. */
  notify(project: string, session: string, text: string): void;
}

/** What the plugin works with. */
export interface Needs {
  gh: Gh;
  remotes: Remotes;
  store: Store;
  clock: Clock;
  out: Out;
  /** The rate-limited hosts, when other readers share them. */
  pauses?: Pauses;
}

/** How long session news waits for more before a read, so the sessions
    told together at the start are read together. */
export const SETTLE_MS = 250;

/** Below this many calls left, a host is not read again until its count
    starts again. */
export const LOW_RATE = 100;

/** How long what gh said of the hosts it is signed in to holds. */
export const HOSTS_MS = 10 * 60_000;

/** How many times gh is asked of its hosts while a made worktree's
    remote is on a host it is not signed in to, before it is asked no more
    until Refresh. */
export const HOST_TRIES = 3;

/** How new a pull request found by looking must be for a `gh pr create`
    whose output was held back to claim it. */
export const MADE_MS = 10 * 60_000;

/** The permissions that may merge. */
const MERGERS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);

/** What gh prints when the pull request it was asked to make is there. */
const EXISTS = /already exists/i;

/** The hosts gh is known to be for without asking it. */
export function obvious(host: string): boolean {
  return host === "github.com" || host.endsWith(".ghe.com");
}

const NOTHING: View = { lines: [], trouble: null, need: null };

export class Watch {
  readonly #gh: Gh;
  readonly #remotes: Remotes;
  readonly #store: Store;
  readonly #clock: Clock;
  readonly #out: Out;
  /** The sessions running. */
  readonly #sessions = new Map<string, Session>();
  readonly #places = new Map<string, Place | null>();
  readonly #pulls = new Map<string, Pull>();
  readonly #branches = new Map<string, string[]>();
  readonly #rights = new Map<string, Rights>();
  readonly #viewers = new Map<string, string | null>();
  /** What stood in the way of the last read of each repository, by
      `repoKey`. */
  #troubles = new Map<string, Trouble>();
  /** The rate-limited hosts. */
  readonly #paused: Pauses;
  /** The hosts gh is signed in to, as it last said, and when it said, or
      null before it said. */
  #hosts: Set<string> | null = null;
  #hostsAt = 0;
  /** How many times gh was asked of its hosts, and how many of the reads
      in a row that asked found a wanted branch on a host not among them. */
  #hostAsks = 0;
  /** What the last check found gh lacking, or null when it has all it
      needs or could not tell. */
  #need: Need | null = null;
  #hostTries = 0;
  /** The repositories GitHub could not find, by `repoKey`, left unread
      until Refresh. Their claims stay on disk. */
  readonly #gone = new Map<string, Trouble>();
  readonly #seen = new Map<string, Seen>();
  readonly #folds = new Map<string, string>();
  readonly #marks = new Map<string, string>();
  #settle: (() => void) | null = null;
  readonly schedule: Schedule;

  constructor(needs: Needs) {
    this.#gh = needs.gh;
    this.#remotes = needs.remotes;
    this.#store = needs.store;
    this.#clock = needs.clock;
    this.#out = needs.out;
    this.#paused = needs.pauses ?? new Pauses();
    this.schedule = new Schedule(needs.clock, () => this.#read());
  }

  /** Reads the claims kept on disk, and checks that gh is there and
      signed in. */
  async start(): Promise<void> {
    await this.#store.load(this.#clock.now());
    await this.check();
  }

  /** Looks for gh and a sign-in: one `gh auth status`, which is also what
      the hosts gh is signed in to are read from. A check that cannot tell,
      because gh did not answer in time or said something else, finds
      nothing lacking. */
  async check(): Promise<void> {
    this.#need = await this.#probe();
  }

  async #probe(): Promise<Need | null> {
    let run: Run | null;
    try {
      run = await within(
        CHECK_MS,
        this.#gh(["auth", "status", "--json", "hosts"]),
      );
    } catch (error) {
      return error instanceof Missing ? "missing" : null;
    }
    if (run === null) return null;
    const hosts = hostsOf(run.stdout);
    if (hosts === null) return saysSignedOut(run) ? "signed-out" : null;
    if (Object.values(hosts).every(failing)) return "signed-out";
    this.#hosts = new Set(Object.keys(hosts).map((host) => host.toLowerCase()));
    this.#hostsAt = this.#clock.now();
    return null;
  }

  /** Stops the timer. */
  stop(): void {
    this.#settle?.();
    this.#settle = null;
    this.schedule.stop();
  }

  /** A session started, or changed, and is running. */
  told(session: Session): void {
    const before = this.#sessions.get(session.id);
    this.#sessions.set(session.id, session);
    if (before === undefined || before.cwd !== session.cwd) {
      this.#places.delete(session.cwd);
    }
    if (
      before === undefined ||
      before.cwd !== session.cwd ||
      before.worktree !== session.worktree ||
      before.branch !== session.branch
    ) {
      this.#soon();
    }
  }

  /** A session ended: its fold and mark went with it, and its pull
      requests are no longer read or told of. */
  ended(id: string): void {
    this.#sessions.delete(id);
    this.#folds.delete(id);
    this.#marks.delete(id);
  }

  /**
   * A command a session ran that makes, merges, closes or readies a pull
   * request. Only a `gh pr create` that went well claims one: the one its
   * output names, or, when the output was held back, the one gh finds for
   * the branch it pushed, if that was made a moment ago and no other
   * session has it. Then everything is read again.
   */
  async heard(heard: Heard): Promise<void> {
    const words = wordsOf(heard.command);
    if (words === null) return;
    if (!this.#sessions.has(heard.session)) {
      this.#sessions.set(heard.session, {
        id: heard.session,
        project: heard.project,
        cwd: heard.cwd,
        worktree: false,
        branch: null,
      });
    }
    if (words.verb === "create" && heard.ok) await this.#made(heard, words);
    this.#places.delete(heard.cwd);
    await this.schedule.now();
  }

  /** Reads everything again at once, asking gh again which hosts it is
      signed in to, and reading a rate-limited host and a repository GitHub
      could not find too. */
  async refresh(): Promise<void> {
    this.#hosts = null;
    await this.check();
    this.#hostTries = 0;
    this.#paused.clear();
    this.#gone.clear();
    this.#places.clear();
    await this.schedule.now();
  }

  /** What a session's fold shows. */
  viewOf(id: string | null): View {
    if (id === null) return { ...NOTHING, need: this.#need };
    return this.#view(this.#world(this.#clock.now()), id);
  }

  /** The web address of a pull request a session's fold shows. */
  urlOf(id: string | null, key: string | null): string {
    return this.#lineOf(id, key).pull.url;
  }

  /** Merges a pull request a session's fold shows, with the repository's
      method, as long as its head is still the one that was read. */
  async merge(id: string | null, key: string | null): Promise<void> {
    const line = this.#lineOf(id, key);
    if (line.merge === null) {
      throw new Error(`#${line.pull.number} cannot be merged as it is`);
    }
    const { pull } = line;
    let run;
    try {
      run = await this.#gh(
        [
          "pr",
          "merge",
          pull.url,
          `--${line.merge}`,
          "--match-head-commit",
          pull.headOid,
        ],
        { cwd: tmpdir(), host: pull.host },
      );
    } catch (error) {
      if (error instanceof Missing) {
        throw new Error("gh is not on the PATH", { cause: error });
      }
      throw error;
    } finally {
      void this.schedule.now();
    }
    if (run.code !== 0) throw new Error(said(run));
  }

  #lineOf(id: string | null, key: string | null): Line {
    const line = this.viewOf(id).lines.find((one) => one.pull.key === key);
    if (line === undefined) {
      throw new Error("that pull request is no longer shown");
    }
    return line;
  }

  /** Reads in a moment, once the news that came with this has come. */
  #soon(): void {
    if (this.#settle !== null) return;
    this.#settle = this.#clock.after(SETTLE_MS, () => {
      this.#settle = null;
      void this.schedule.now();
    });
  }

  /** Claims the pull request a `gh pr create` that went well made. One
      its output names is the session's even when another had it; one
      found by looking only when nobody has it. */
  async #made(heard: Heard, words: Words): Promise<void> {
    let ref: PullRef | null;
    let take: boolean;
    if (heard.output !== null) {
      if (EXISTS.test(heard.output)) return;
      ref = pullUrls(heard.output).at(-1) ?? null;
      take = true;
    } else {
      ref = await this.#lookedUp(heard, words);
      take = false;
    }
    if (ref === null) return;
    const now = this.#clock.now();
    const key = pullKey(ref);
    // gh just saw the repository it made the pull request in.
    this.#gone.delete(repoKey(ref));
    if (!take) {
      const others = owners(this.#world(now), key);
      if (others.some((id) => id !== heard.session)) return;
    }
    if (this.#store.claim(heard.session, key, now, take)) {
      await this.#store.save().catch(() => undefined);
    }
  }

  /** The pull request gh finds where a command ran for the branch it
      pushed, when it was made within MADE_MS. */
  async #lookedUp(heard: Heard, words: Words): Promise<PullRef | null> {
    const args = ["pr", "view"];
    if (words.head !== null) args.push(words.head);
    if (words.repo !== null) args.push("--repo", words.repo);
    args.push("--json", "url,createdAt");
    let found: { url?: unknown; createdAt?: unknown };
    try {
      const run = await this.#gh(args, { cwd: heard.cwd });
      if (run.code !== 0) return null;
      found = JSON.parse(run.stdout) as typeof found;
    } catch {
      return null;
    }
    if (typeof found.url !== "string" || typeof found.createdAt !== "string") {
      return null;
    }
    const made = Date.parse(found.createdAt);
    if (Number.isNaN(made) || this.#clock.now() - made > MADE_MS) return null;
    return pullOfUrl(found.url);
  }

  #world(now: number): World {
    return {
      sessions: this.#sessions,
      claims: this.#store.claims(),
      places: this.#places,
      pulls: this.#pulls,
      branches: this.#branches,
      now,
    };
  }

  /** One read of everything wanted, one call per repository, leaving out
      the hosts that are rate limited. */
  async #read(): Promise<Outcome> {
    let now = this.#clock.now();
    await this.#placeAll();
    const want = wanted(this.#world(now));
    const claimed = new Set(want.refs.map((ref) => ref.host));
    const branches = [];
    let signed: ReadonlySet<string> | null = null;
    let unsigned = false;
    const asked = this.#hostAsks;
    for (const one of want.branches) {
      const host = one.repo.host;
      if (!obvious(host) && !claimed.has(host)) {
        signed ??= await this.#signedIn(now);
        if (!signed.has(host)) {
          unsigned = true;
          continue;
        }
      }
      branches.push(one);
    }
    if (!unsigned) this.#hostTries = 0;
    else if (this.#hostAsks > asked) this.#hostTries += 1;

    const troubles = new Map<string, Trouble>();
    const asks: Ask[] = [];
    for (const ask of asksOf(want.refs, branches)) {
      const gone = this.#gone.get(repoKey(ask));
      if (gone !== undefined) {
        troubles.set(repoKey(ask), gone);
        continue;
      }
      const until = this.#paused.until(ask.host, now);
      if (until !== null) {
        troubles.set(repoKey(ask), { kind: "limited", host: ask.host, until });
      } else {
        asks.push(ask);
      }
    }
    const answers = await Promise.all(
      asks.map((ask) =>
        readRepo(this.#gh, ask).catch(
          (error: unknown): { trouble: Trouble } => ({
            trouble: {
              kind: "failed",
              host: ask.host,
              text: error instanceof Error ? error.message : String(error),
            },
          }),
        ),
      ),
    );
    now = this.#clock.now();

    let changed = false;
    let saving = false;
    const fresh: Pull[] = [];
    const limited = new Set<string>();
    const fine = new Set<string>();
    answers.forEach((answer, at) => {
      const ask = asks[at] as Ask;
      if ("gone" in answer) {
        const trouble: Trouble = {
          kind: "gone",
          host: ask.host,
          repo: `${ask.owner}/${ask.name}`,
        };
        this.#lose(ask);
        this.#gone.set(repoKey(ask), trouble);
        troubles.set(repoKey(ask), trouble);
        return;
      }
      if ("trouble" in answer) {
        const trouble = answer.trouble;
        if (trouble.kind === "limited") {
          limited.add(ask.host);
          const until = this.#paused.pause(ask.host, trouble.until, now);
          troubles.set(repoKey(ask), { ...trouble, until });
        } else {
          troubles.set(repoKey(ask), trouble);
        }
        return;
      }
      this.#take(answer);
      for (const pull of answer.pulls.values()) {
        const had = this.#pulls.get(pull.key);
        if (had === undefined || JSON.stringify(had) !== JSON.stringify(pull)) {
          changed = true;
        }
        this.#pulls.set(pull.key, pull);
        fresh.push(pull);
        const closed = pull.state === "OPEN" ? null : (pull.closedAt ?? now);
        if (this.#store.closed(pull.key, closed)) saving = true;
      }
      if (answer.rate !== null && answer.rate.remaining < LOW_RATE) {
        limited.add(ask.host);
        this.#paused.pause(ask.host, answer.rate.resetAt, now);
      } else {
        fine.add(ask.host);
      }
    });
    for (const host of fine) {
      if (!limited.has(host)) this.#paused.lift(host);
    }
    this.#troubles = troubles;

    const world = this.#world(now);
    this.#tell(world, fresh);
    this.#prune(world, want.refs, branches);
    for (const id of this.#sessions.keys()) {
      if (world.claims.has(id)) this.#store.seen(id, now);
    }
    this.#store.prune(now);
    if (saving) await this.#store.save().catch(() => undefined);
    if (this.#send(this.#world(now))) changed = true;

    // A paused host is read again when its pause ends, and a branch on a
    // host gh is not signed in to is looked for again once what gh said
    // of its hosts no longer holds, until gh was asked HOST_TRIES times.
    const wakes = this.#paused.ends(now);
    if (unsigned && this.#hostTries < HOST_TRIES) {
      wakes.push((this.#hosts === null ? now : this.#hostsAt) + HOSTS_MS);
    }
    const wake = wakes.length === 0 ? null : Math.min(...wakes);
    return { watching: this.#watching(world, troubles), changed, wake };
  }

  /** Lets go of everything read from a repository GitHub could not find.
      What sessions claimed in it stays theirs. */
  #lose(ask: Ask): void {
    const repo = repoKey(ask);
    for (const key of [...this.#pulls.keys()]) {
      if (!key.startsWith(`${repo}#`)) continue;
      this.#pulls.delete(key);
      this.#seen.delete(key);
    }
    for (const branch of ask.branches) {
      this.#branches.delete(branchKey(ask, branch));
    }
  }

  /** Takes in what a repository answered besides its pull requests. */
  #take(read: Read): void {
    this.#rights.set(repoKey(read.repo), read.rights);
    this.#viewers.set(read.repo.host, read.viewer);
    for (const [branch, keys] of read.branches) {
      this.#branches.set(branchKey(read.repo, branch), keys);
    }
  }

  /** Reads the repository of every made worktree's folder not read yet. */
  async #placeAll(): Promise<void> {
    const folders = new Set<string>();
    for (const session of this.#sessions.values()) {
      if (!session.worktree || session.branch === null) continue;
      if (!this.#places.has(session.cwd)) folders.add(session.cwd);
    }
    await Promise.all(
      [...folders].map(async (cwd) => {
        const listing = await this.#remotes(cwd).catch(() => "");
        this.#places.set(cwd, placeOf(listing));
      }),
    );
  }

  /**
   * The hosts gh says it is signed in to, which is where a branch on a
   * host other than github.com, GitHub's own hosted enterprises and the
   * hosts of claimed pull requests is looked up, so a folder whose remote
   * is elsewhere is never asked of GitHub. What gh said holds for
   * HOSTS_MS; when it could not say, it is asked again on the next read.
   * Once it was asked HOST_TRIES times and a wanted branch was on a host it
   * did not list, what it said last holds until Refresh.
   */
  async #signedIn(now: number): Promise<ReadonlySet<string>> {
    if (this.#hosts !== null && now - this.#hostsAt < HOSTS_MS) {
      return this.#hosts;
    }
    if (this.#hostTries >= HOST_TRIES) return this.#hosts ?? new Set();
    this.#hostAsks += 1;
    let hosts: unknown;
    try {
      const run = await this.#gh(["auth", "status", "--json", "hosts"]);
      hosts = (JSON.parse(run.stdout) as { hosts?: unknown }).hosts;
    } catch {
      hosts = null;
    }
    if (typeof hosts !== "object" || hosts === null) return new Set();
    this.#hosts = new Set(Object.keys(hosts).map((host) => host.toLowerCase()));
    this.#hostsAt = now;
    return this.#hosts;
  }

  /** Tells each change of a pull request read to the running sessions
      that own it. */
  #tell(world: World, fresh: Pull[]): void {
    for (const pull of fresh) {
      const viewer = this.#viewers.get(pull.host) ?? null;
      const { seen, lines } = notice(this.#seen.get(pull.key), pull, viewer);
      this.#seen.set(pull.key, seen);
      if (lines.length === 0) continue;
      for (const id of owners(world, pull.key)) {
        const session = this.#sessions.get(id);
        if (session === undefined) continue;
        for (const line of lines) this.#out.notify(session.project, id, line);
      }
    }
  }

  /** Lets go of the pull requests and branches no longer wanted. */
  #prune(
    world: World,
    refs: PullRef[],
    branches: { repo: Repo; branch: string }[],
  ): void {
    const keep = new Set(refs.map(pullKey));
    const looked = new Set(
      branches.map((one) => branchKey(one.repo, one.branch)),
    );
    for (const key of [...this.#branches.keys()]) {
      if (!looked.has(key)) this.#branches.delete(key);
    }
    for (const keys of this.#branches.values()) {
      for (const key of keys) keep.add(key);
    }
    for (const id of this.#sessions.keys()) {
      for (const key of owned(world, id)) keep.add(key);
    }
    for (const key of [...this.#pulls.keys()]) {
      if (keep.has(key)) continue;
      this.#pulls.delete(key);
      this.#seen.delete(key);
    }
  }

  /** Whether an open pull request is shown, or a repository failed in a
      way a later read may get past. */
  #watching(world: World, troubles: Map<string, Trouble>): boolean {
    for (const trouble of troubles.values()) {
      if (trouble.kind === "failed") return true;
    }
    for (const id of this.#sessions.keys()) {
      for (const key of owned(world, id)) {
        if (this.#pulls.get(key)?.state === "OPEN") return true;
      }
    }
    return false;
  }

  /** Sends the folds and marks that changed, and answers whether any
      did. */
  #send(world: World): boolean {
    let changed = false;
    for (const [id, session] of this.#sessions) {
      const view = this.#view(world, id);
      const fold = JSON.stringify([
        rowsOf(view),
        detailOf(view),
        headerOf(view),
      ]);
      if (fold !== (this.#folds.get(id) ?? EMPTY)) {
        this.#folds.set(id, fold);
        this.#out.fold(session.project, id);
        changed = true;
      }
      const tally = tallyOf(view.lines.map((line) => line.pull));
      const mark = JSON.stringify(tally);
      if (mark !== (this.#marks.get(id) ?? "null")) {
        this.#marks.set(id, mark);
        this.#out.mark(session.project, id, tally);
        changed = true;
      }
    }
    return changed;
  }

  #view(world: World, id: string): View {
    const keys = owned(world, id);
    const lines: Line[] = [];
    for (const key of keys) {
      const pull = this.#pulls.get(key);
      if (pull === undefined) continue;
      lines.push({ pull, merge: this.#mergeOf(pull) });
    }
    lines.sort(
      (a, b) =>
        Number(a.pull.state !== "OPEN") - Number(b.pull.state !== "OPEN"),
    );
    return { lines, trouble: this.#troubleOf(world, id, keys), need: null };
  }

  #mergeOf(pull: Pull): Line["merge"] {
    if (!readyToMerge(pull)) return null;
    const rights = this.#rights.get(repoKey(pull));
    if (rights === undefined || !MERGERS.has(rights.permission ?? "")) {
      return null;
    }
    return rights.method;
  }

  /** What stood in the way of reading the repositories a session's pull
      requests, or its made worktree's branch, are in. */
  #troubleOf(world: World, id: string, keys: string[]): Trouble | null {
    const repos = new Set<string>();
    for (const key of keys) {
      const ref = refOfKey(key);
      if (ref !== null) repos.add(repoKey(ref));
    }
    const session = world.sessions.get(id);
    if (session?.worktree === true && session.branch !== null) {
      const place = world.places.get(session.cwd);
      if (place !== undefined && place !== null) {
        repos.add(repoKey(place.base));
      }
    }
    for (const repo of repos) {
      const trouble = this.#troubles.get(repo);
      if (trouble !== undefined) return trouble;
    }
    return null;
  }
}

/** How long a check waits for gh before it tells nothing. */
export const CHECK_MS = 10_000;

/** What a promise answers, or null when it has not within `ms`. */
async function within<T>(ms: number, work: Promise<T>): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The hosts in what `gh auth status --json hosts` printed, or null when
    it printed something else. */
function hostsOf(stdout: string): Record<string, unknown> | null {
  try {
    const { hosts } = JSON.parse(stdout) as { hosts?: unknown };
    return typeof hosts === "object" && hosts !== null
      ? (hosts as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Whether every account of a host has a token gh found invalid. */
function failing(accounts: unknown): boolean {
  return (
    Array.isArray(accounts) &&
    accounts.length > 0 &&
    accounts.every(
      (one) => (one as { state?: unknown } | null)?.state === "error",
    )
  );
}

/** What an empty fold was sent as, which is what a fold never sent is. */
const EMPTY = JSON.stringify([[], null, []]);
