/**
 * The reviews asked of the user, and the review sessions the plugin offers
 * to start for them. The hosts of the open projects' repositories are
 * searched on a timer of their own; a review asked since the last look is
 * told once, and each project's page is sent what it shows. A review starts
 * only through the app's card, in the project whose page asked when its
 * repository is the pull request's and in the first such project when it
 * is not, and a review asked again goes to the session that did the first
 * one. While a start or a line for a pull request waits on its answer,
 * another click on it does nothing. gh, git, the clock and the app are all
 * handed in, so a test can stand in for each. A project's page shows the
 * reviews asked on every host, or, once its overview is opened, those of
 * the project's repository and the user's own open pull requests there.
 */

import type { StartOptions } from "@elva-labs/workbench-plugin";
import { repoKey, type Repo } from "./address.js";
import { timeOf } from "./app.js";
import type { Gh, Trouble } from "./gh.js";
import { readMine, type Mine } from "./mine.js";
import type { Pauses } from "./pauses.js";
import { placeOf, type Place, type Remotes } from "./place.js";
import {
  againLine,
  againPrompt,
  askedNote,
  askedNotes,
  REVIEWER,
  reviewName,
  reviewPrompt,
} from "./prompts.js";
import type { Pull } from "./pulls.js";
import { readAsks, type Asked, type Asks } from "./requests.js";
import { keyOfRef, refOf, type Reviews } from "./reviews.js";
import { Schedule, type Clock, type Outcome } from "./schedule.js";
import {
  checksOf,
  reviewsOf,
  stateOf,
  summaryOf,
  type Reviews as ReviewStanding,
  type State,
} from "./standing.js";
import { HOSTS_MS, LOW_RATE, obvious } from "./watch.js";

/** What the offers tell the app. */
export interface OfferOut {
  /** Says a line as the plugin's own notification. */
  notify(project: string, text: string, target: string): void;
  /** Sends a session's fold again. */
  fold(project: string, session: string): void;
  /** Sends a project's page what it shows. */
  data(project: string, data: PageData): void;
  /** Asks, on the app's card, to start a session. */
  start(project: string, answers: string, options: StartOptions): void;
  /** Sends a line to a session the plugin started. */
  send(answers: string, session: string, text: string): void;
  /** Opens a web address. */
  openUrl(project: string, answers: string, url: string): void;
  /** Looks again at what a project is offered in the app's palette. */
  offer(project: string): void;
}

/** What the offers work with. */
export interface OfferNeeds {
  gh: Gh;
  remotes: Remotes;
  clock: Clock;
  pauses: Pauses;
  reviews: Reviews;
  out: OfferOut;
}

/** Where a review asked stands. */
export type Standing =
  "requested" | "reviewing" | "ready" | "again" | "again-new" | "none";

/** One review asked, as the page shows it. */
export interface PageRow {
  key: string;
  title: string;
  url: string;
  /** The repository, `owner/name`, with its host when that is not
      github.com. */
  repo: string;
  number: number;
  author: string;
  at: number;
  draft: boolean;
  checks: { failed: number; passed: number; running: number };
  standing: Standing;
  /** The session that reviews it, when it is one of the page's project. */
  session: string | null;
  /** Whether the line last sent for a review asked again was not put to
      the session. */
  refused: boolean;
}

/** One of the user's own open pull requests, as the page shows it. */
export interface MineRow {
  key: string;
  title: string;
  url: string;
  number: number;
  /** The branch it comes from. */
  head: string;
  draft: boolean;
  state: State;
  checks: PageRow["checks"];
  review: { kind: ReviewStanding["kind"]; who: string[] };
  /** What it is waiting on, in a few words. */
  summary: string;
}

/** What a project's page shows. */
export interface PageData {
  updated: number | null;
  trouble: string | null;
  rows: PageRow[];
  /** The one repository shown, when the page is a project's overview. */
  repo?: string;
  /** The user's own open pull requests there, or null while they have not
      been read. Only an overview has it. */
  mine?: MineRow[] | null;
}

/** The longest a notification's target may be, in bytes. */
export const TARGET_MAX = 256;

/** How long the app lets the plugin answer a click, in milliseconds. */
export const ANSWER_MS = 30_000;

/** How long a line sent waits for what came of it, in milliseconds. */
export const SENT_MS = 10 * 60_000;

/** The target of a notification that names no one pull request. */
export const ASKS_TARGET = "asks";

/** A pull request's target on the page. */
export function targetOf(key: string): string {
  const target = `pr/${key}`;
  return Buffer.byteLength(target) <= TARGET_MAX ? target : ASKS_TARGET;
}

/** What came of one host's search, or that it was not made. */
type Read =
  | { host: string; paused: Trouble }
  | { host: string; answer: Asks | { trouble: Trouble } };

/** The user's own pull requests in one repository, as last read. */
interface Own {
  pulls: Pull[] | null;
  trouble: Trouble | null;
}

/** What one host's search left standing. */
interface Host {
  asks: Asked[];
  trouble: Trouble | null;
}

export class Offers {
  readonly #gh: Gh;
  readonly #remotes: Remotes;
  readonly #clock: Clock;
  readonly #pauses: Pauses;
  readonly #reviews: Reviews;
  readonly #out: OfferOut;
  /** The open projects, in the order the app told them. */
  readonly #projects: string[] = [];
  readonly #places = new Map<string, Place | null>();
  readonly #hosts = new Map<string, Host>();
  /** The projects whose page is an overview of their repository. */
  readonly #overviews = new Set<string>();
  /** The user's pull requests in the overviews' repositories, by
      repository key. */
  readonly #own = new Map<string, Own>();
  /** The hosts looked at once already, whose new asks are told. */
  readonly #looked = new Set<string>();
  /** The running sessions, by id, and their projects. */
  readonly #sessions = new Map<string, string>();
  readonly #folds = new Map<string, string>();
  readonly #pages = new Map<string, string>();
  /** Lines sent for a review asked again, by the id they answer, with
      when they were sent. */
  readonly #sent = new Map<
    string,
    { key: string; project: string; at: number }
  >();
  /** The pull requests a start or a line was asked for, by key, with until
      when that waits on its answer. */
  readonly #pending = new Map<string, number>();
  /** The pull requests whose last line was refused. */
  readonly #refused = new Set<string>();
  #signed: Set<string> | null = null;
  #signedAt = 0;
  /** The call to gh asking for its hosts, while one is on its way. */
  #asking: Promise<void> | null = null;
  /** Whether every project's repository is to be read again. */
  #replace = false;
  #updated: number | null = null;
  readonly schedule: Schedule;

  constructor(needs: OfferNeeds) {
    this.#gh = needs.gh;
    this.#remotes = needs.remotes;
    this.#clock = needs.clock;
    this.#pauses = needs.pauses;
    this.#reviews = needs.reviews;
    this.#out = needs.out;
    this.schedule = new Schedule(needs.clock, () => this.#read());
  }

  /** Reads the review sessions kept on disk. */
  async start(): Promise<void> {
    await this.#reviews.load(this.#clock.now());
  }

  /** Stops the timer. */
  stop(): void {
    this.schedule.stop();
  }

  /** A project is open. */
  opened(project: string): Promise<void> {
    if (!this.#projects.includes(project)) this.#projects.push(project);
    this.#places.delete(project);
    return this.schedule.now();
  }

  /** A project closed. */
  closed(project: string): void {
    const at = this.#projects.indexOf(project);
    if (at !== -1) this.#projects.splice(at, 1);
    this.#places.delete(project);
    this.#pages.delete(project);
    this.#overviews.delete(project);
  }

  /** Whether a project's overview is offered: its repository is on a host
      gh is signed in to. */
  async offered(project: string): Promise<boolean> {
    let place = this.#places.get(project);
    if (place === undefined) {
      place = placeOf(await this.#remotes(project).catch(() => ""));
    }
    if (place === null) return false;
    return (await this.#signedIn(this.#now())).has(place.base.host);
  }

  /** Makes a project's page the overview of its repository, and reads at
      once. */
  overview(project: string): void {
    this.#overviews.add(project);
    this.#pages.delete(project);
    this.#page(project);
    void this.schedule.now();
  }

  /** Makes a project's page show the reviews asked in every repository. */
  everything(project: string): void {
    this.#overviews.delete(project);
    this.#pages.delete(project);
    this.#page(project);
  }

  /** Searches every host again at once, a rate-limited one too, reading
      the projects' remotes and gh's hosts again. The pauses are shared,
      so this lifts a searched host's pause for the pull requests' reads
      as well. */
  refresh(): Promise<void> {
    this.#replace = true;
    this.#signedAt = -Infinity;
    this.#asking = null;
    for (const host of this.#hosts.keys()) this.#pauses.lift(host);
    return this.schedule.now();
  }

  /** A session is running, with the ref the plugin started it with. */
  told(id: string, project: string, ref: string | null): void {
    this.#sessions.set(id, project);
    const key = keyOfRef(ref ?? undefined);
    if (key !== null) {
      this.#pending.delete(key);
      this.#refused.delete(key);
    }
    if (key !== null && this.#reviews.started(key, id, project, this.#now())) {
      void this.#reviews.save().catch(() => undefined);
    }
    this.#send();
  }

  /** A session ended or was put away. */
  ended(id: string): void {
    this.#sessions.delete(id);
    this.#folds.delete(id);
    if (this.#reviews.ended(id)) {
      void this.#reviews.save().catch(() => undefined);
    }
    this.#send();
  }

  /** The reviews asked, newest first. */
  asks(): Asked[] {
    return [...this.#hosts.values()]
      .flatMap((host) => host.asks)
      .sort((a, b) => b.at - a.at);
  }

  /** The asks a session's fold counts: every one, while its project is a
      checkout of a repository on a host searched. */
  asksFor(project: string): Asked[] {
    const place = this.#places.get(project);
    if (place === undefined || place === null) return [];
    const searched = [place.base, ...place.remotes].some((repo) =>
      this.#hosts.has(repo.host),
    );
    return searched ? this.asks() : [];
  }

  /** The review asked of a pull request, by key, or null. */
  askOf(key: string): Asked | null {
    return this.asks().find((ask) => ask.key === key) ?? null;
  }

  /** The pull requests a session reviews that are still asked. */
  reviewedBy(session: string): Asked[] {
    return this.#reviews
      .keysOf(session)
      .map((key) => this.askOf(key))
      .filter((ask): ask is Asked => ask !== null);
  }

  /** The project a pull request's repository is open as, its base first,
      or null. Of the projects that have it alike, `rather` comes first
      when it is one, then the order they were opened in. */
  projectOf(repo: Repo, rather: string | null = null): string | null {
    const key = repoKey(repo);
    const projects =
      rather !== null && this.#projects.includes(rather)
        ? [rather, ...this.#projects.filter((one) => one !== rather)]
        : this.#projects;
    for (const project of projects) {
      const place = this.#places.get(project);
      if (place && repoKey(place.base) === key) return project;
    }
    for (const project of projects) {
      const place = this.#places.get(project);
      if (place?.remotes.some((one) => repoKey(one) === key)) return project;
    }
    return null;
  }

  /** Where a review asked stands. */
  standingOf(ask: Asked): Standing {
    if (this.projectOf(ask) === null) return "none";
    const review = this.#reviews.of(ask.key);
    if (review === null)
      return ask.reviewed === null ? "requested" : "again-new";
    if (ask.reviewed !== null && ask.reviewed > review.at) return "again";
    return review.live ? "reviewing" : "ready";
  }

  /** What a project's page shows. */
  dataOf(project: string): PageData {
    if (this.#overviews.has(project)) return this.#overviewOf(project);
    return {
      updated: this.#updated,
      trouble: this.#troubleText(),
      rows: this.asks().map((ask) => this.#rowOf(ask, project)),
    };
  }

  /** A message from a project's page, with the id of the click that sent
      it, if it came of one. */
  message(project: string, payload: unknown, id: string | null): void {
    if (typeof payload !== "object" || payload === null) return;
    const { do: verb, key } = payload as { do?: unknown; key?: unknown };
    if (verb === "ready") {
      this.#pages.delete(project);
      this.#page(project);
      return;
    }
    if (verb === "refresh") {
      void this.refresh();
      return;
    }
    if (verb === "all") {
      this.everything(project);
      return;
    }
    if (id === null || typeof key !== "string") return;
    if (verb === "open") {
      const url = (this.askOf(key) ?? this.#ownOf(key))?.url;
      if (url !== undefined) this.#out.openUrl(project, id, url);
      return;
    }
    const ask = this.askOf(key);
    if (ask === null) return;
    const now = this.#now();
    this.#forget(now);
    if (this.#pending.has(key)) return;
    const standing = this.standingOf(ask);
    if (verb === "start") {
      if (standing === "requested") this.#start(ask, id, false, project);
      if (standing === "again-new") this.#start(ask, id, true, project);
      return;
    }
    if (verb === "again" && standing === "again") {
      const review = this.#reviews.of(key);
      if (review === null) return;
      this.#sent.set(id, { key, project, at: now });
      try {
        this.#out.send(id, review.session, againLine(ask));
      } catch {
        this.#sent.delete(id);
        return;
      }
      this.#pending.set(key, now + ANSWER_MS);
      if (this.#refused.delete(key)) this.#send();
    }
  }

  /** What came of a line sent for a review asked again: the session has
      it, or a new session is offered in its place. */
  sent(id: string, outcome: "delivered" | "gone" | "refused"): void {
    this.#forget(this.#now());
    const sent = this.#sent.get(id);
    if (sent === undefined) return;
    this.#sent.delete(id);
    this.#pending.delete(sent.key);
    if (outcome === "refused") {
      this.#refused.add(sent.key);
      this.#send();
      return;
    }
    this.#refused.delete(sent.key);
    if (outcome === "delivered") {
      this.#reviews.given(sent.key, this.#now());
    } else {
      this.#reviews.drop(sent.key);
      const ask = this.askOf(sent.key);
      if (ask !== null) this.#start(ask, id, true, sent.project);
    }
    void this.#reviews.save().catch(() => undefined);
    this.#send();
  }

  /** Asks to start a review, in the project whose page asked when its
      repository is the pull request's. */
  #start(ask: Asked, id: string, again: boolean, asked: string): void {
    const project = this.projectOf(ask, asked);
    if (project === null) return;
    try {
      this.#out.start(project, id, {
        prompt: again ? againPrompt(ask) : reviewPrompt(ask),
        name: reviewName(ask),
        ref: refOf(ask.key),
        worktree: true,
        purpose: "review",
        agent: REVIEWER,
      });
    } catch {
      // A start the plugin may not ask for is no start.
      return;
    }
    this.#pending.set(ask.key, this.#now() + ANSWER_MS);
  }

  /** Lets go of what waits on an answer past its time. */
  #forget(now: number): void {
    for (const [key, until] of this.#pending) {
      if (until <= now) this.#pending.delete(key);
    }
    for (const [id, sent] of this.#sent) {
      if (now - sent.at >= SENT_MS) this.#sent.delete(id);
    }
  }

  #rowOf(ask: Asked, project: string): PageRow {
    const review = this.#reviews.of(ask.key);
    return {
      key: ask.key,
      title: ask.title,
      url: ask.url,
      repo: shownAs(ask),
      number: ask.number,
      author: ask.author,
      at: ask.at,
      draft: ask.draft,
      checks: countsOf(ask),
      standing: this.standingOf(ask),
      session:
        review !== null && review.project === project ? review.session : null,
      refused: this.#refused.has(ask.key),
    };
  }

  #overviewOf(project: string): PageData {
    const place = this.#places.get(project);
    if (!place) {
      return {
        updated: this.#updated,
        trouble: null,
        rows: [],
        repo: "",
        mine: place === null ? [] : null,
      };
    }
    const key = repoKey(place.base);
    const own = this.#own.get(key);
    const trouble =
      this.#hosts.get(place.base.host)?.trouble ?? own?.trouble ?? null;
    return {
      updated: this.#updated,
      trouble: trouble === null ? null : troubleText(trouble),
      rows: this.asks()
        .filter((ask) => repoKey(ask) === key)
        .map((ask) => this.#rowOf(ask, project)),
      repo: shownAs(place.base),
      mine: own?.pulls?.map(mineRowOf) ?? null,
    };
  }

  /** One of the user's own pull requests read, by key, or null. */
  #ownOf(key: string): Pull | null {
    for (const own of this.#own.values()) {
      const found = own.pulls?.find((pull) => pull.key === key);
      if (found !== undefined) return found;
    }
    return null;
  }

  #troubleText(): string | null {
    for (const host of this.#hosts.values()) {
      if (host.trouble !== null) return troubleText(host.trouble);
    }
    return null;
  }

  #now(): number {
    return this.#clock.now();
  }

  /** One search of every host the open projects' repositories are on,
      leaving out the hosts that are rate limited. */
  async #read(): Promise<Outcome> {
    let now = this.#now();
    await this.#placeAll();
    const hosts = await this.#searched(now);
    for (const host of [...this.#hosts.keys()]) {
      if (!hosts.has(host)) {
        this.#hosts.delete(host);
        this.#looked.delete(host);
      }
    }
    const reads = [...hosts].map(async (host): Promise<Read> => {
      const until = this.#pauses.until(host, now);
      if (until !== null) {
        return { host, paused: { kind: "limited", host, until } };
      }
      return {
        host,
        answer: await readAsks(this.#gh, host).catch(failed(host)),
      };
    });
    const [answers, owned] = await Promise.all([
      Promise.all(reads),
      this.#readOwn(hosts, now),
    ]);
    now = this.#now();

    let changed = false;
    const fresh: Asked[] = [];
    for (const one of answers) {
      const had = this.#hosts.get(one.host);
      if ("paused" in one) {
        this.#hosts.set(one.host, {
          asks: had?.asks ?? [],
          trouble: one.paused,
        });
        continue;
      }
      const answer = one.answer;
      if ("trouble" in answer) {
        let trouble = answer.trouble;
        if (trouble.kind === "limited") {
          const until = this.#pauses.pause(one.host, trouble.until, now);
          trouble = { ...trouble, until };
        }
        this.#hosts.set(one.host, { asks: had?.asks ?? [], trouble });
        continue;
      }
      if (answer.rate !== null && answer.rate.remaining < LOW_RATE) {
        this.#pauses.pause(one.host, answer.rate.resetAt, now);
      } else {
        this.#pauses.lift(one.host);
      }
      // GitHub takes a review's request away once it is given, so an ask
      // whose review is newer than the one last seen was asked again.
      const before = new Map((had?.asks ?? []).map((ask) => [ask.key, ask]));
      if (this.#looked.has(one.host)) {
        fresh.push(
          ...answer.asks.filter((ask) => {
            const seen = before.get(ask.key);
            return (
              seen === undefined ||
              (ask.reviewed ?? -Infinity) > (seen.reviewed ?? -Infinity)
            );
          }),
        );
      }
      this.#looked.add(one.host);
      if (JSON.stringify(had?.asks ?? null) !== JSON.stringify(answer.asks)) {
        changed = true;
      }
      this.#hosts.set(one.host, { asks: answer.asks, trouble: null });
    }
    if (this.#keepOwn(owned, now)) changed = true;
    this.#updated = now;
    this.#reviews.prune(now);
    this.#tell(fresh);
    this.#send();
    for (const project of this.#projects) this.#out.offer(project);

    const ends = [...hosts]
      .map((host) => this.#pauses.until(host, now))
      .filter((until): until is number => until !== null);
    return {
      watching: hosts.size > 0,
      changed,
      wake: ends.length === 0 ? null : Math.min(...ends),
    };
  }

  /** Searches the user's pull requests in each overview's repository that
      is on a searched host. */
  #readOwn(hosts: ReadonlySet<string>, now: number): Promise<OwnRead[]> {
    const repos = new Map<string, Repo>();
    for (const project of this.#overviews) {
      const base = this.#places.get(project)?.base;
      if (base && hosts.has(base.host)) repos.set(repoKey(base), base);
    }
    return Promise.all(
      [...repos].map(async ([key, repo]): Promise<OwnRead> => {
        const until = this.#pauses.until(repo.host, now);
        if (until !== null) {
          const paused: Trouble = { kind: "limited", host: repo.host, until };
          return { key, host: repo.host, answer: { trouble: paused } };
        }
        return {
          key,
          host: repo.host,
          answer: await readMine(this.#gh, repo).catch(failed(repo.host)),
        };
      }),
    );
  }

  /** Keeps what the searches of the user's pull requests found, pausing a
      host that is out of calls, and says whether any list changed. */
  #keepOwn(reads: OwnRead[], now: number): boolean {
    let changed = false;
    for (const { key, host, answer } of reads) {
      const had = this.#own.get(key)?.pulls ?? null;
      if ("trouble" in answer) {
        let trouble = answer.trouble;
        if (trouble.kind === "limited") {
          const until =
            this.#pauses.until(host, now) ??
            this.#pauses.pause(host, trouble.until, now);
          trouble = { ...trouble, until };
        }
        this.#own.set(key, { pulls: had, trouble });
        continue;
      }
      if (answer.rate !== null && answer.rate.remaining < LOW_RATE) {
        this.#pauses.pause(host, answer.rate.resetAt, now);
      }
      if (JSON.stringify(had) !== JSON.stringify(answer.pulls)) changed = true;
      this.#own.set(key, { pulls: answer.pulls, trouble: null });
    }
    return changed;
  }

  /** Tells the reviews asked since the last look: one by itself, several
      in one line. */
  #tell(fresh: Asked[]): void {
    const first = fresh[0];
    if (first === undefined) return;
    if (fresh.length === 1) {
      const project = this.projectOf(first) ?? this.#projects[0];
      if (project === undefined) return;
      this.#out.notify(project, askedNote(first), targetOf(first.key));
      return;
    }
    const project =
      fresh.map((ask) => this.projectOf(ask)).find((one) => one !== null) ??
      this.#projects[0];
    if (project === undefined) return;
    this.#out.notify(project, askedNotes(fresh.length), ASKS_TARGET);
  }

  /** Sends again the folds and pages that changed. */
  #send(): void {
    for (const [session, project] of this.#sessions) {
      const shown = JSON.stringify([
        this.asksFor(project).map((ask) => [ask.key, ask.author]),
        this.reviewedBy(session).map((ask) => [ask.key, ask.title, ask.url]),
      ]);
      if (this.#folds.get(session) === shown) continue;
      this.#folds.set(session, shown);
      this.#out.fold(project, session);
    }
    for (const project of this.#projects) this.#page(project);
  }

  #page(project: string): void {
    const data = this.dataOf(project);
    const shown = JSON.stringify(data);
    if (this.#pages.get(project) === shown) return;
    this.#pages.set(project, shown);
    this.#out.data(project, data);
  }

  /** Reads the repository of every open project not read yet, and of
      every one after a Refresh. What was read before stands until then. */
  async #placeAll(): Promise<void> {
    const every = this.#replace;
    this.#replace = false;
    await Promise.all(
      this.#projects
        .filter((project) => every || !this.#places.has(project))
        .map(async (project) => {
          const listing = await this.#remotes(project).catch(() => "");
          if (!this.#projects.includes(project)) return;
          this.#places.set(project, placeOf(listing));
        }),
    );
  }

  /** The hosts searched: those of the open projects' repositories that are
      GitHub's own or that gh is signed in to. */
  async #searched(now: number): Promise<Set<string>> {
    const wanted = new Set<string>();
    for (const project of this.#projects) {
      const place = this.#places.get(project);
      if (!place) continue;
      for (const repo of [place.base, ...place.remotes]) wanted.add(repo.host);
    }
    const hosts = new Set<string>();
    for (const host of wanted) {
      if (obvious(host) || (await this.#signedIn(now)).has(host)) {
        hosts.add(host);
      }
    }
    return hosts;
  }

  /** The hosts gh says it is signed in to, as it said within HOSTS_MS.
      Everyone asking at once waits on one call, and while gh cannot say,
      what it said last holds. */
  async #signedIn(now: number): Promise<ReadonlySet<string>> {
    if (this.#signed !== null && now - this.#signedAt < HOSTS_MS) {
      return this.#signed;
    }
    if (this.#asking === null) {
      const asking: Promise<void> = this.#askHosts().then((hosts) => {
        // A Refresh leaves an earlier call's answer behind.
        if (this.#asking !== asking) return;
        this.#asking = null;
        if (hosts === null) return;
        this.#signed = hosts;
        this.#signedAt = now;
      });
      this.#asking = asking;
    }
    await this.#asking;
    return this.#signed ?? new Set();
  }

  /** The hosts `gh auth status` lists, or null when it could not say. */
  async #askHosts(): Promise<Set<string> | null> {
    try {
      const run = await this.#gh(["auth", "status", "--json", "hosts"]);
      const { hosts } = JSON.parse(run.stdout) as { hosts?: unknown };
      if (typeof hosts !== "object" || hosts === null) return null;
      return new Set(Object.keys(hosts).map((host) => host.toLowerCase()));
    } catch {
      return null;
    }
  }
}

/** What came of one repository's search of the user's pull requests. */
interface OwnRead {
  key: string;
  host: string;
  answer: Mine | { trouble: Trouble };
}

/** A repository as the page names it: `owner/name`, with its host when
    that is not github.com. */
function shownAs(repo: Repo): string {
  const named = `${repo.owner}/${repo.name}`;
  return repo.host === "github.com" ? named : `${repo.host}/${named}`;
}

function countsOf(pull: Pick<Pull, "checks">): PageRow["checks"] {
  const checks = checksOf(pull);
  return {
    failed: checks.failed.length,
    passed: checks.passed,
    running: checks.running,
  };
}

function mineRowOf(pull: Pull): MineRow {
  const { kind, who } = reviewsOf(pull);
  return {
    key: pull.key,
    title: pull.title,
    url: pull.url,
    number: pull.number,
    head: pull.head,
    draft: pull.draft,
    state: stateOf(pull) ?? "ok",
    checks: countsOf(pull),
    review: { kind, who },
    summary: summaryOf(pull),
  };
}

function failed(host: string) {
  return (error: unknown): { trouble: Trouble } => ({
    trouble: {
      kind: "failed",
      host,
      text: error instanceof Error ? error.message : String(error),
    },
  });
}

/** What stands in the way of a search, in a few words. */
export function troubleText(trouble: Trouble): string {
  switch (trouble.kind) {
    case "missing":
      return "gh is not on the PATH.";
    case "signed-out":
      return `Not signed in to ${trouble.host}.`;
    case "limited":
      return trouble.until === null
        ? `Rate limited on ${trouble.host}.`
        : `Rate limited on ${trouble.host} until ${timeOf(trouble.until)}.`;
    case "failed":
      return `gh failed on ${trouble.host}: ${trouble.text}`;
    case "gone":
      return `${trouble.host} cannot find ${trouble.repo}.`;
  }
}
