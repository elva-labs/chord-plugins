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
import { Missing, said, type Gh, type Trouble } from "./gh.js";
import {
  branchKey,
  owners,
  shown,
  wanted,
  type Owned,
  type Session,
  type World,
} from "./mapping.js";
import { notice, type Seen } from "./notices.js";
import { placeOf, type Place, type Remotes } from "./place.js";
import {
  asksOf,
  readRepo,
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
}

/** How long session news waits for more before a read, so the sessions
    told together at the start are read together. */
export const SETTLE_MS = 250;

/** Below this many calls left, a host is read as rate limited until its
    count starts again. */
export const LOW_RATE = 100;

/** The permissions that may merge. */
const MERGERS = new Set(["ADMIN", "MAINTAIN", "WRITE"]);

/** The hosts gh is known to be for without asking it. */
function obvious(host: string): boolean {
  return host === "github.com" || host.endsWith(".ghe.com");
}

const NOTHING: View = { lines: [], trouble: null };

export class Watch {
  readonly #gh: Gh;
  readonly #remotes: Remotes;
  readonly #store: Store;
  readonly #clock: Clock;
  readonly #out: Out;
  /** Every session told of, and those started by one still running. */
  readonly #sessions = new Map<string, Session>();
  /** The sessions still running. */
  readonly #live = new Set<string>();
  readonly #places = new Map<string, Place | null>();
  readonly #pulls = new Map<string, Pull>();
  readonly #branches = new Map<string, string[]>();
  readonly #rights = new Map<string, Rights>();
  readonly #viewers = new Map<string, string | null>();
  #troubles = new Map<string, Trouble>();
  #missing = false;
  /** The hosts gh is signed in to, as it last said, or null before it was
      asked. */
  #hosts: Set<string> | null = null;
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
    this.schedule = new Schedule(needs.clock, () => this.#read());
  }

  /** Reads the claims kept on disk. */
  async start(): Promise<void> {
    await this.#store.load(this.#clock.now());
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
    this.#live.add(session.id);
    if (before === undefined || before.cwd !== session.cwd) {
      this.#places.delete(session.cwd);
    }
    if (
      before === undefined ||
      before.cwd !== session.cwd ||
      before.worktree !== session.worktree ||
      before.branch !== session.branch ||
      before.startedBy !== session.startedBy
    ) {
      this.#soon();
    }
  }

  /** A session ended: its fold and mark went with it. */
  ended(id: string): void {
    this.#live.delete(id);
    this.#folds.delete(id);
    this.#marks.delete(id);
    this.#forget();
  }

  /**
   * A command a session ran that makes, merges, closes or readies a pull
   * request. The pull request is the one its output names, else the one
   * it names itself, else the one gh finds where it ran. One it made is
   * the session's; one it merged, closed or readied is the session's when
   * no other session has it. Then everything is read again.
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
        startedBy: null,
      });
      this.#live.add(heard.session);
    }
    this.#places.delete(heard.cwd);
    const ref = await this.#refOf(heard, words);
    if (ref !== null) {
      const now = this.#clock.now();
      const key = pullKey(ref);
      const take = words.verb === "create" && heard.ok;
      if (this.#store.claim(heard.session, key, now, take)) {
        await this.#store.save().catch(() => undefined);
      }
    }
    await this.schedule.now();
  }

  /** Reads everything again at once, asking gh again which hosts it is
      signed in to. */
  async refresh(): Promise<void> {
    this.#hosts = null;
    this.#places.clear();
    await this.schedule.now();
  }

  /** What a session's fold shows. */
  viewOf(id: string | null): View {
    if (id === null) return NOTHING;
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

  /** Lets go of the sessions that ended and that no running session
      started. */
  #forget(): void {
    for (const id of [...this.#sessions.keys()]) {
      if (this.#live.has(id) || this.#liveAbove(id)) continue;
      this.#sessions.delete(id);
    }
  }

  /** The nearest running session above one, or null. */
  #liveAbove(id: string): string | null {
    const seen = new Set([id]);
    let at = this.#sessions.get(id)?.startedBy ?? null;
    while (at !== null && !seen.has(at)) {
      if (this.#live.has(at)) return at;
      seen.add(at);
      at = this.#sessions.get(at)?.startedBy ?? null;
    }
    return null;
  }

  async #refOf(heard: Heard, words: Words): Promise<PullRef | null> {
    if (heard.output !== null) {
      const found = pullUrls(heard.output);
      const last = found[found.length - 1];
      if (last !== undefined) return last;
    }
    if (words.target !== null) {
      const named = pullOfUrl(words.target);
      if (named !== null) return named;
    }
    if (!heard.ok) return null;
    const target = words.verb === "create" ? words.head : words.target;
    const args = ["pr", "view"];
    if (target !== null) args.push(target);
    if (words.repo !== null) args.push("--repo", words.repo);
    args.push("--json", "url,number");
    try {
      const run = await this.#gh(args, { cwd: heard.cwd });
      if (run.code !== 0) return null;
      const url = (JSON.parse(run.stdout) as { url?: unknown }).url;
      return typeof url === "string" ? pullOfUrl(url) : null;
    } catch {
      return null;
    }
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

  /** One read of everything wanted, one call per repository. */
  async #read(): Promise<Outcome> {
    let now = this.#clock.now();
    await this.#placeAll();
    const before = this.#world(now);
    const want = wanted(before);
    const claimed = new Set(want.refs.map((ref) => ref.host));
    const branches = [];
    for (const one of want.branches) {
      if (await this.#lookable(one.repo.host, claimed)) branches.push(one);
    }
    const asks = asksOf(want.refs, branches);
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

    const troubles = new Map<string, Trouble>();
    let missing = false;
    let changed = false;
    let saving = false;
    const fresh: Pull[] = [];
    answers.forEach((answer, at) => {
      const ask = asks[at] as (typeof asks)[number];
      if ("trouble" in answer) {
        if (answer.trouble.kind === "missing") missing = true;
        else troubles.set(ask.host, answer.trouble);
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
        troubles.set(ask.host, {
          kind: "limited",
          host: ask.host,
          until: answer.rate.resetAt,
        });
      }
    });
    this.#troubles = troubles;
    this.#missing = missing;

    const world = this.#world(now);
    this.#tell(world, fresh);
    this.#prune(world, want.refs, branches);
    for (const id of this.#live) {
      if (world.claims.has(id)) this.#store.seen(id, now);
    }
    this.#store.prune(now);
    if (saving) await this.#store.save().catch(() => undefined);
    if (this.#send(this.#world(now))) changed = true;

    const limited = [...troubles.values()].filter(
      (trouble) => trouble.kind === "limited",
    );
    const untils = limited
      .map((trouble) => (trouble.kind === "limited" ? trouble.until : null))
      .filter((until): until is number => until !== null);
    return {
      watching: this.#watching(world, troubles),
      changed,
      limited: limited.length > 0,
      until: untils.length === 0 ? null : Math.max(...untils),
    };
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
   * Whether a branch's pull requests are looked up on a host: github.com
   * and GitHub's own hosted enterprises always, a host a claimed pull
   * request is on, and any other host gh says it is signed in to, so a
   * folder whose remote is elsewhere is never asked of GitHub.
   */
  async #lookable(host: string, claimed: Set<string>): Promise<boolean> {
    if (obvious(host) || claimed.has(host)) return true;
    if (this.#hosts === null) this.#hosts = await this.#signedIn();
    return this.#hosts.has(host);
  }

  async #signedIn(): Promise<Set<string>> {
    try {
      const run = await this.#gh(["auth", "status", "--json", "hosts"]);
      const hosts = (JSON.parse(run.stdout) as { hosts?: unknown }).hosts;
      if (typeof hosts !== "object" || hosts === null) return new Set();
      return new Set(Object.keys(hosts).map((host) => host.toLowerCase()));
    } catch {
      return new Set();
    }
  }

  /** Tells each change of a pull request read to the running sessions
      that own it, or to the nearest running one above each. */
  #tell(world: World, fresh: Pull[]): void {
    for (const pull of fresh) {
      const viewer = this.#viewers.get(pull.host) ?? null;
      const { seen, lines } = notice(this.#seen.get(pull.key), pull, viewer);
      this.#seen.set(pull.key, seen);
      if (lines.length === 0) continue;
      const told = new Set<string>();
      for (const owner of owners(world, pull.key)) {
        const to = this.#live.has(owner) ? owner : this.#liveAbove(owner);
        if (to !== null) told.add(to);
      }
      for (const id of told) {
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
    for (const id of this.#live) {
      for (const owned of shown(world, id)) keep.add(owned.key);
    }
    for (const key of [...this.#pulls.keys()]) {
      if (keep.has(key)) continue;
      this.#pulls.delete(key);
      this.#seen.delete(key);
    }
  }

  /** Whether an open pull request is shown, or a host failed in a way a
      later read may get past. */
  #watching(world: World, troubles: Map<string, Trouble>): boolean {
    for (const trouble of troubles.values()) {
      if (trouble.kind === "failed") return true;
    }
    for (const id of this.#live) {
      for (const owned of shown(world, id)) {
        if (this.#pulls.get(owned.key)?.state === "OPEN") return true;
      }
    }
    return false;
  }

  /** Sends the folds and marks that changed, and answers whether any
      did. */
  #send(world: World): boolean {
    let changed = false;
    for (const id of this.#live) {
      const session = this.#sessions.get(id);
      if (session === undefined) continue;
      const view = this.#view(world, id);
      const fold = JSON.stringify([
        rowsOf(view),
        detailOf(view, world.now),
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
    const owned = shown(world, id);
    const lines: Line[] = [];
    for (const one of owned) {
      const pull = this.#pulls.get(one.key);
      if (pull === undefined) continue;
      lines.push({
        pull,
        from: one.from === null ? null : (this.#sessions.get(one.from) ?? null),
        merge: this.#mergeOf(pull),
      });
    }
    lines.sort(
      (a, b) =>
        Number(a.pull.state !== "OPEN") - Number(b.pull.state !== "OPEN"),
    );
    return { lines, trouble: this.#troubleOf(world, id, owned) };
  }

  #mergeOf(pull: Pull): Line["merge"] {
    if (!readyToMerge(pull)) return null;
    const rights = this.#rights.get(repoKey(pull));
    if (rights === undefined || !MERGERS.has(rights.permission ?? "")) {
      return null;
    }
    return rights.method;
  }

  /** What stands in the way of reading what a session shows, when it
      shows or looks for anything at all. */
  #troubleOf(world: World, id: string, owned: Owned[]): Trouble | null {
    const hosts = new Set<string>();
    for (const one of owned) {
      const ref = refOfKey(one.key);
      if (ref !== null) hosts.add(ref.host);
    }
    const session = world.sessions.get(id);
    if (session?.worktree === true && session.branch !== null) {
      const place = world.places.get(session.cwd);
      if (place !== undefined && place !== null) {
        const host = place.base.host;
        if (obvious(host) || this.#hosts?.has(host) === true) hosts.add(host);
      }
    }
    if (hosts.size === 0) return null;
    if (this.#missing) return { kind: "missing" };
    for (const host of hosts) {
      const trouble = this.#troubles.get(host);
      if (trouble !== undefined) return trouble;
    }
    return null;
  }
}

/** What an empty fold was sent as, which is what a fold never sent is. */
const EMPTY = JSON.stringify([[], null, []]);
