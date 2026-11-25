import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type {
  Action,
  ActionCall,
  AppMessage,
  CommandEvent,
  DeclaredSection,
  DeclaredTool,
  DiffOptions,
  Greeting,
  HelloEvent,
  Mark,
  OpenOptions,
  PaletteCommand,
  PickCall,
  PluginMessage,
  PresentOptions,
  ProjectEvent,
  Row,
  SentEvent,
  SessionEvent,
  StartOptions,
  StopEvent,
  ToolCall,
  TreeEvent,
  ViewMessageEvent,
  ViewOptions,
} from "./types.js";

/** Who the plugin is, as the manifest names it, and the room its page
    asks for when it has one. */
export interface PluginOptions {
  name: string;
  version: string;
  view?: "wide" | "full";
}

/** What the agent is told about a tool. */
export interface ToolOptions {
  description: string;
  inputSchema?: Record<string, unknown>;
}

/** The project a tool call is for, and the session that made it. */
export interface ToolContext {
  project: string;
  session: string | null;
}

/**
 * A tool's handler. What it returns becomes the call's content: a string
 * as it is, anything else as JSON. What it throws becomes the error the
 * agent reads.
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<string | unknown> | string | unknown;

/** Whom a section's rows are for: a project, and one of its sessions or
    null for the whole project. */
export interface SectionContext {
  project: string;
  session: string | null;
}

/** A section: its header, the actions on it, and the rows it draws. */
export interface SectionOptions {
  title: string;
  /** The actions on the section's header. A function is asked each time
      the rows are sent, for a header that depends on what they hold. */
  actions?: Action[] | ((context: SectionContext) => Action[]);
  /** A short line beside the section's title. It is asked each time the
      rows are sent, alongside them, and nothing is sent for a detail that
      is empty or that could not be found. */
  detail?: (context: SectionContext) => Promise<string | null> | string | null;
  /** Whether the section starts folded where the app draws it as a group
      of its own. */
  folded?: boolean;
  rows: (context: SectionContext) => Promise<Row[]> | Row[];
}

/** The row an action was taken on, the input given, the project, and the
    session whose section it was. */
export interface ActionContext {
  row: Row | null;
  input: Record<string, string>;
  project: string;
  /** The session whose section the action was on, or null on a project's
      section. */
  session: string | null;
  /** Opens a web address in the user's browser, once per action and only
      while the handler runs. An address that is not http or https is
      refused. */
  openUrl(url: string): void;
}

/** An action's handler. What it throws is shown to the user. */
export type ActionHandler = (call: ActionContext) => Promise<void> | void;

/** The project a palette command is offered for. */
export interface PaletteContext {
  project: string;
}

/** A command in the app's palette. */
export interface PaletteOptions {
  /** What the palette calls it: one line of 60 characters at most that
      starts with a capital or a digit. The app lists no command named like
      one of its own. */
  label: string;
  /** Whether the command is offered for a project, asked when the project
      opens and on each `refreshPalette`. A command without it is offered
      for every project, and one whose `when` throws is not offered. */
  when?: (context: PaletteContext) => Promise<boolean> | boolean;
}

/** The pick of a palette command: its id, the project that was on screen,
    and the session the user had in front of them or null. */
export interface PickContext {
  id: string;
  project: string;
  session: string | null;
  /** Opens a web address in the user's browser, once per pick and only
      while the handler runs. An address that is not http or https is
      refused. */
  openUrl(url: string): void;
}

/** A palette command's handler. The app waits 10 seconds for it. What it
    throws is shown to the user. */
export type PickHandler = (pick: PickContext) => Promise<void> | void;

/** The events a plugin can listen for. */
export interface Events {
  hello: HelloEvent;
  project: ProjectEvent;
  session: SessionEvent;
  command: CommandEvent;
  tree: TreeEvent;
  stop: StopEvent;
  view_message: ViewMessageEvent;
  sent: SentEvent;
}

/** Where the loop reads and writes, for a test that drives it itself. */
export interface RunOptions {
  input?: Readable;
  output?: Writable;
}

/** A plugin: its tools, its sections, and the loop that runs them. */
export interface Plugin {
  /** Registers a tool the agent can call under the plugin's name. */
  tool(name: string, options: ToolOptions, handler: ToolHandler): Plugin;
  /** Registers a section of rows under the tree. */
  section(id: string, options: SectionOptions): Plugin;
  /** Registers what one of a section's actions does. */
  action(section: string, action: string, handler: ActionHandler): Plugin;
  /** Registers a command in the app's palette, which the manifest lists
      under `palette`, and what picking it does. */
  palette(id: string, options: PaletteOptions, handler: PickHandler): Plugin;
  /** Listens for one of the app's events. */
  on<K extends keyof Events>(
    event: K,
    handler: (event: Events[K]) => unknown,
  ): Plugin;
  /** Computes a section's rows for a project, or for one of its sessions,
      and sends them. */
  refresh(
    section: string,
    project: string,
    session?: string | null,
  ): Promise<void>;
  /** Asks each palette command's `when` about an open project again, and
      sends the project's commands when they differ from the last sent. */
  refreshPalette(project: string): Promise<void>;
  /** Opens a place in the viewer. */
  open(project: string, place: OpenOptions): void;
  /** Shows a file's diff. */
  diff(project: string, file: DiffOptions): void;
  /** Presents media. */
  present(project: string, media: PresentOptions): void;
  /** Puts a line on a session's row, or with no session says it as the
      plugin's own notification, which opens the plugin's page with the
      target when it is clicked. */
  notify(
    project: string,
    text: string,
    session?: string | null,
    target?: string,
  ): void;
  /** Opens a web address in the user's browser, in answer to an id the
      app gave the plugin within the last 30 seconds. */
  openUrl(project: string, answers: string, url: string): void;
  /** Asks the user, on the app's card, to start a session, in answer to an
      id the app gave the plugin within the last 30 seconds. */
  start(project: string, answers: string, session: StartOptions): void;
  /** Sends a line to a session the plugin started, in answer to an id the
      app gave the plugin within the last 30 seconds. What came of it
      arrives at `on("sent", handler)`. */
  send(answers: string, session: string, text: string): void;
  /** Puts the plugin's one mark on a session's row, in place of the last
      one, or takes it away when the mark is null. */
  mark(project: string, session: string, mark: Mark | null): void;
  /** Sends the plugin's page for a project, which stands until the next
      one. Only a page the user asked for is sent open. */
  view(project: string, page: ViewOptions): void;
  /** Sends the page what it asked the plugin for. */
  viewData(project: string, data: unknown): void;
  /** Greets the app and handles messages until it is told to stop. */
  run(options?: RunOptions): Promise<void>;
}

/** A schema for a tool that declared none: arguments of any shape. */
const ANY_OBJECT: Record<string, unknown> = { type: "object", properties: {} };

/** A name is a plain identifier, the same one the app accepts. */
const NAME = /^[a-z][a-z0-9_-]*$/;

/** The longest web address the app opens. */
const URL_MAX = 2048;

/** The longest prompt a start carries, and line a send does, in bytes. */
const PROMPT_MAX = 8 * 1024;
const TEXT_MAX = 4 * 1024;

/** The longest ref, agent title and notification target, in bytes. */
const TAG_MAX = 256;

/** The most palette commands a plugin declares. */
const PALETTE_MAX = 8;

/** The longest label of a palette command, in characters. */
const LABEL_MAX = 60;

/** How a label begins: a digit, or a letter that is not lowercase. */
const LABEL_START = /^(?!\p{Lowercase})[\p{Alphabetic}\p{N}]/u;

/** The characters the app takes out of a label before it judges it: the
    controls, the format characters and the ones that draw nothing. */
const UNLABELLED =
  /[\p{Cc}\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u115F-\u1160\u17B4-\u17B5\u180B-\u180F\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB\u{110BD}\u{110CD}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/gu;

/** How long a pick's handler has, in milliseconds, which is short of the
    10 seconds the app waits for the result. */
const PICK_MS = 9_000;

/** Characters that draw nothing, which the app passes over before it
    looks at how a prompt begins. */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]/gu;

function bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Whether a line reads as a command to the app rather than words. */
function command(text: string): boolean {
  const seen = text.replace(UNSEEN, "");
  return seen.startsWith("/") || seen.startsWith("!");
}

/** A section's header actions: the list it was registered with, or what
    the function it was registered with says for this project. */
function headerOf(section: Section, context: SectionContext): Action[] {
  const actions = section.actions;
  return typeof actions === "function" ? actions(context) : actions;
}

/** A section's detail for a project, and an empty line for a section
    with none and for one whose detail could not be found. */
async function detailOf(
  section: Section,
  context: SectionContext,
): Promise<string> {
  if (section.detail === undefined) return "";
  try {
    return (await section.detail(context)) ?? "";
  } catch {
    return "";
  }
}

/** Where a section's last rows are kept: the project, and the session
    after it when there is one. */
function keyOf(project: string, session: string | null): string {
  return session === null ? project : `${project}\u0000${session}`;
}

/** Whether a web address is one the app opens: http or https, no longer
    than it allows, with no white space. */
function openable(url: string): boolean {
  if (url.length > URL_MAX || /\s/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function checkName(what: string, name: string): void {
  if (!NAME.test(name) || name.length > 40) {
    throw new Error(
      `the ${what} name ${JSON.stringify(name)} must start with a lowercase ` +
        "letter and hold only lowercase letters, digits, dashes and underscores",
    );
  }
}

/** A label as the app reads it: no character that draws nothing, and one
    space wherever there is white space. */
function shownLabel(label: string): string {
  return label
    .replace(/\p{White_Space}/gu, " ")
    .replace(UNLABELLED, "")
    .split(" ")
    .filter(Boolean)
    .join(" ");
}

function checkLabel(label: string): void {
  const shown = shownLabel(label);
  if (
    !LABEL_START.test(shown) ||
    /[\r\n\u2028\u2029]/.test(label) ||
    [...shown].length > LABEL_MAX
  ) {
    throw new Error(
      `the label ${JSON.stringify(label)} must be one line of ${LABEL_MAX} ` +
        "characters at most that starts with a capital or a digit",
    );
  }
}

/** Content of any shape reaches the agent as text. */
function content(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value) ?? "";
}

function reason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error);
  return text === "" ? "the handler failed" : text;
}

interface Tool {
  declared: DeclaredTool;
  handler: ToolHandler;
}

interface Section {
  declared: DeclaredSection;
  actions: NonNullable<SectionOptions["actions"]>;
  detail: SectionOptions["detail"];
  rows: SectionOptions["rows"];
}

interface Palette {
  options: PaletteOptions;
  handler: PickHandler;
}

/** An opener for one call the app answers to: it writes one `open_url`
    line, only while the call is unanswered. */
function opener(
  call: "action" | "pick",
  answered: () => boolean,
  write: (url: string) => void,
): (url: string) => void {
  let opened = false;
  return (url) => {
    if (answered()) throw new Error(`the ${call} has already been answered`);
    if (opened) {
      const one = call === "action" ? "an action" : "a pick";
      throw new Error(`${one} opens one web address`);
    }
    if (!openable(url)) {
      throw new Error(`not a web address the app opens: ${url}`);
    }
    opened = true;
    write(url);
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class Builder implements Plugin {
  readonly #name: string;
  readonly #version: string;
  readonly #view: "wide" | "full" | null;
  readonly #tools = new Map<string, Tool>();
  readonly #sections = new Map<string, Section>();
  readonly #actions = new Map<string, ActionHandler>();
  readonly #listeners = new Map<string, Array<(event: never) => unknown>>();
  /** The projects open on the machine, as the app has told it. */
  readonly #projects = new Set<string>();
  /** The rows each section last sent, by project and session, so an
      action knows its row. */
  readonly #rows = new Map<string, Map<string, Row[]>>();
  readonly #palette = new Map<string, Palette>();
  /** The commands last sent for each open project, as one string. */
  readonly #offered = new Map<string, string>();
  /** The latest look at each project's commands, so an older one that
      finishes late sends nothing. */
  readonly #looks = new Map<string, number>();
  #look = 0;
  #output: Writable | null = null;
  #stop: (() => void) | null = null;

  constructor(options: PluginOptions) {
    checkName("plugin", options.name);
    const view = options.view ?? null;
    if (view !== null && view !== "wide" && view !== "full") {
      throw new Error("the view must be wide or full");
    }
    this.#name = options.name;
    this.#version = options.version;
    this.#view = view;
  }

  tool(name: string, options: ToolOptions, handler: ToolHandler): Plugin {
    checkName("tool", name);
    if (this.#tools.has(name)) {
      throw new Error(`the tool ${JSON.stringify(name)} is registered twice`);
    }
    this.#tools.set(name, {
      declared: {
        name,
        description: options.description,
        inputSchema: options.inputSchema ?? ANY_OBJECT,
      },
      handler,
    });
    return this;
  }

  section(id: string, options: SectionOptions): Plugin {
    checkName("section", id);
    if (this.#sections.has(id)) {
      throw new Error(`the section ${JSON.stringify(id)} is registered twice`);
    }
    this.#sections.set(id, {
      declared: {
        id,
        title: options.title,
        actions: [],
        ...(options.folded === true ? { folded: true } : {}),
      },
      actions: options.actions ?? [],
      detail: options.detail,
      rows: options.rows,
    });
    return this;
  }

  action(section: string, action: string, handler: ActionHandler): Plugin {
    checkName("section", section);
    checkName("action", action);
    const key = `${section}/${action}`;
    if (this.#actions.has(key)) {
      throw new Error(
        `the action ${JSON.stringify(action)} of ${JSON.stringify(section)} is registered twice`,
      );
    }
    this.#actions.set(key, handler);
    return this;
  }

  palette(id: string, options: PaletteOptions, handler: PickHandler): Plugin {
    checkName("palette command", id);
    checkLabel(options.label);
    if (this.#palette.has(id)) {
      throw new Error(
        `the palette command ${JSON.stringify(id)} is registered twice`,
      );
    }
    const label = shownLabel(options.label).toLowerCase();
    for (const other of this.#palette.values()) {
      if (shownLabel(other.options.label).toLowerCase() === label) {
        throw new Error(
          `two palette commands are called ${JSON.stringify(options.label)}`,
        );
      }
    }
    if (this.#palette.size === PALETTE_MAX) {
      throw new Error(`a plugin has ${PALETTE_MAX} palette commands at most`);
    }
    this.#palette.set(id, { options, handler });
    return this;
  }

  on<K extends keyof Events>(
    event: K,
    handler: (event: Events[K]) => unknown,
  ): Plugin {
    const handlers = this.#listeners.get(event) ?? [];
    handlers.push(handler as (event: never) => unknown);
    this.#listeners.set(event, handlers);
    return this;
  }

  async refresh(
    section: string,
    project: string,
    session: string | null = null,
  ): Promise<void> {
    const registered = this.#sections.get(section);
    if (!registered || project === "") return;
    const context: SectionContext = { project, session: session || null };
    // The detail is found while the rows are.
    const said = detailOf(registered, context);
    let rows: Row[];
    try {
      rows = (await registered.rows(context)) ?? [];
    } catch {
      return;
    }
    const detail = await said;
    const kept = this.#rows.get(section) ?? new Map<string, Row[]>();
    kept.set(keyOf(project, context.session), rows);
    this.#rows.set(section, kept);
    this.#write({
      type: "section",
      id: section,
      title: registered.declared.title,
      project,
      ...(context.session === null ? {} : { session: context.session }),
      rows,
      actions: headerOf(registered, context),
      ...(detail === "" ? {} : { detail }),
      ...(registered.declared.folded === true ? { folded: true } : {}),
    });
  }

  async refreshPalette(project: string): Promise<void> {
    if (this.#palette.size === 0 || !this.#projects.has(project)) return;
    const look = ++this.#look;
    this.#looks.set(project, look);
    const found = await Promise.all(
      [...this.#palette].map(async ([id, { options }]) => {
        try {
          if (options.when && !(await options.when({ project }))) return null;
        } catch {
          return null;
        }
        return { id, label: options.label };
      }),
    );
    if (this.#looks.get(project) !== look) return;
    const commands: PaletteCommand[] = found.filter((one) => one !== null);
    const said = JSON.stringify(commands);
    if (this.#offered.get(project) === said) return;
    this.#offered.set(project, said);
    this.#write({ type: "palette", project, commands });
  }

  open(project: string, place: OpenOptions): void {
    this.#write({ type: "open", project, ...place });
  }

  diff(project: string, file: DiffOptions): void {
    this.#write({ type: "diff", project, ...file });
  }

  present(project: string, media: PresentOptions): void {
    this.#write({ type: "present", project, ...media });
  }

  notify(
    project: string,
    text: string,
    session?: string | null,
    target?: string,
  ): void {
    if (target !== undefined && bytes(target) > TAG_MAX) {
      throw new Error(`a target is ${TAG_MAX} bytes at most`);
    }
    this.#write({
      type: "notify",
      project,
      text,
      ...(session ? { session } : {}),
      ...(target ? { target } : {}),
    });
  }

  openUrl(project: string, answers: string, url: string): void {
    if (!openable(url)) {
      throw new Error(`not a web address the app opens: ${url}`);
    }
    this.#write({ type: "open_url", project, answers, url });
  }

  start(project: string, answers: string, session: StartOptions): void {
    if (bytes(session.prompt) > PROMPT_MAX) {
      throw new Error(`a prompt is ${PROMPT_MAX} bytes at most`);
    }
    if (command(session.prompt)) {
      throw new Error("a prompt may not begin with / or !");
    }
    for (const [what, value] of [
      ["ref", session.ref],
      ["agent", session.agent],
    ] as const) {
      if (value !== undefined && bytes(value) > TAG_MAX) {
        throw new Error(`a start's ${what} is ${TAG_MAX} bytes at most`);
      }
    }
    this.#write({
      type: "start",
      answers,
      project,
      prompt: session.prompt,
      ...(session.name === undefined ? {} : { name: session.name }),
      ...(session.ref === undefined ? {} : { ref: session.ref }),
      ...(session.worktree === undefined ? {} : { worktree: session.worktree }),
      ...(session.purpose === undefined ? {} : { purpose: session.purpose }),
      ...(session.agent === undefined ? {} : { agent: session.agent }),
    });
  }

  send(answers: string, session: string, text: string): void {
    if (bytes(text) > TEXT_MAX) {
      throw new Error(`a line sent is ${TEXT_MAX} bytes at most`);
    }
    if (command(text)) {
      throw new Error("a line sent may not begin with / or !");
    }
    this.#write({ type: "send", answers, session, text });
  }

  mark(project: string, session: string, mark: Mark | null): void {
    if (mark === null) {
      this.#write({ type: "mark", project, session, icon: null });
      return;
    }
    this.#write({ type: "mark", project, session, ...mark });
  }

  view(project: string, page: ViewOptions): void {
    this.#write({ type: "view", project, ...page });
  }

  viewData(project: string, data: unknown): void {
    this.#write({ type: "view_data", project, data });
  }

  async run(options: RunOptions = {}): Promise<void> {
    const input = options.input ?? process.stdin;
    this.#output = options.output ?? process.stdout;
    this.#write(this.#greeting());
    const lines = createInterface({ input, crlfDelay: Infinity });
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        lines.close();
        input.pause();
        resolve();
      };
      this.#stop = finish;
      lines.on("line", (line) => void this.#line(line));
      lines.on("close", finish);
    });
    this.#stop = null;
  }

  #greeting(): Greeting {
    return {
      type: "hello",
      name: this.#name,
      version: this.#version,
      tools: [...this.#tools.values()].map((tool) => tool.declared),
      sections: [...this.#sections.values()].map((section) => ({
        ...section.declared,
        actions: headerOf(section, { project: "", session: null }),
      })),
      view: this.#view === null ? null : { width: this.#view },
    };
  }

  #write(message: PluginMessage): void {
    this.#output?.write(`${JSON.stringify(message)}\n`);
  }

  /**
   * One line from the app. A line that is not a message, or a message of a
   * kind the plugin does not know, is left alone, and nothing a handler
   * does reaches the loop.
   */
  async #line(line: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObject(message) || typeof message.type !== "string") return;
    try {
      await this.#handle(message as unknown as AppMessage);
    } catch {
      // A handler that failed has already been answered.
    }
  }

  async #handle(message: AppMessage): Promise<void> {
    switch (message.type) {
      case "hello":
        for (const project of message.projects ?? []) {
          this.#projects.add(project);
        }
        this.#offered.clear();
        this.#emit("hello", message);
        await Promise.all([
          this.#refreshAll(),
          ...[...this.#projects].map((one) => this.refreshPalette(one)),
        ]);
        return;
      case "project":
        await this.#project(message);
        return;
      case "session":
        if (message.event === "ended")
          this.#forget(message.project, message.id);
        this.#emit("session", message);
        return;
      case "command":
      case "tree":
      case "view_message":
      case "sent":
        this.#emit(message.type, message);
        return;
      case "stop":
        this.#emit("stop", message);
        this.#stop?.();
        return;
      case "tool":
        await this.#tool(message);
        return;
      case "action":
        await this.#action(message);
        return;
      case "pick":
        await this.#pick(message);
        return;
      default:
        return;
    }
  }

  async #project(event: ProjectEvent): Promise<void> {
    if (event.event === "opened") {
      this.#projects.add(event.path);
      this.#offered.delete(event.path);
    } else {
      this.#projects.delete(event.path);
      this.#looks.delete(event.path);
      this.#offered.delete(event.path);
      for (const kept of this.#rows.values()) {
        for (const key of kept.keys()) {
          if (key === event.path || key.startsWith(`${event.path}\u0000`)) {
            kept.delete(key);
          }
        }
      }
    }
    this.#emit("project", event);
    if (event.event !== "opened") return;
    await Promise.all([
      ...[...this.#sections.keys()].map((section) =>
        this.refresh(section, event.path),
      ),
      this.refreshPalette(event.path),
    ]);
  }

  async #refreshAll(): Promise<void> {
    const work: Array<Promise<void>> = [];
    for (const project of this.#projects) {
      for (const section of this.#sections.keys()) {
        work.push(this.refresh(section, project));
      }
    }
    await Promise.all(work);
  }

  async #tool(call: { type: "tool" } & ToolCall): Promise<void> {
    const tool = this.#tools.get(call.name);
    if (!tool) {
      this.#write({
        type: "result",
        id: call.id,
        error: `no such tool: ${call.name}`,
      });
      return;
    }
    try {
      const answer = await tool.handler(call.arguments ?? {}, {
        project: call.project,
        session: call.session ?? null,
      });
      this.#write({ type: "result", id: call.id, content: content(answer) });
    } catch (error) {
      this.#write({ type: "result", id: call.id, error: reason(error) });
    }
  }

  async #action(call: { type: "action" } & ActionCall): Promise<void> {
    const handler = this.#actions.get(`${call.section}/${call.action}`);
    if (!handler) {
      this.#write({
        type: "result",
        id: call.id,
        error: `no such action: ${call.section}/${call.action}`,
      });
      return;
    }
    const session = call.session || null;
    let answered = false;
    const openUrl = opener(
      "action",
      () => answered,
      (url) =>
        this.#write({
          type: "open_url",
          project: call.project,
          action: call.id,
          url,
        }),
    );
    try {
      await handler({
        row: this.#rowOf(call.section, call.project, session, call.row),
        input: call.input ?? {},
        project: call.project,
        session,
        openUrl,
      });
      answered = true;
      this.#write({ type: "result", id: call.id });
    } catch (error) {
      answered = true;
      this.#write({ type: "result", id: call.id, error: reason(error) });
    } finally {
      await this.refresh(call.section, call.project, session);
    }
  }

  async #pick(pick: { type: "pick" } & PickCall): Promise<void> {
    const command = this.#palette.get(pick.command);
    if (!command) {
      this.#write({
        type: "result",
        id: pick.id,
        error: `no such palette command: ${pick.command}`,
      });
      return;
    }
    let answered = false;
    const openUrl = opener(
      "pick",
      () => answered,
      (url) =>
        this.#write({
          type: "open_url",
          project: pick.project,
          answers: pick.id,
          url,
        }),
    );
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("the command did not finish in time")),
        PICK_MS,
      );
    });
    try {
      await Promise.race([
        command.handler({
          id: pick.id,
          project: pick.project,
          session: pick.session || null,
          openUrl,
        }),
        late,
      ]);
      answered = true;
      this.#write({ type: "result", id: pick.id });
    } catch (error) {
      answered = true;
      this.#write({ type: "result", id: pick.id, error: reason(error) });
    } finally {
      clearTimeout(timer);
    }
  }

  /** The row an action was taken on, as the section last sent it. */
  #rowOf(
    section: string,
    project: string,
    session: string | null,
    id: string | null,
  ): Row | null {
    if (!id) return null;
    const rows = this.#rows.get(section)?.get(keyOf(project, session)) ?? [];
    return rows.find((row) => row.id === id) ?? null;
  }

  /** Lets go of the rows a session's sections last sent, once it has
      ended and the app has let go of them too. */
  #forget(project: string, session: string): void {
    if (!session) return;
    for (const kept of this.#rows.values())
      kept.delete(keyOf(project, session));
  }

  #emit<K extends keyof Events>(event: K, message: Events[K]): void {
    for (const handler of this.#listeners.get(event) ?? []) {
      try {
        const answer = (handler as (event: Events[K]) => unknown)(message);
        if (answer instanceof Promise) answer.catch(() => {});
      } catch {
        // A listener that failed does not stop the others.
      }
    }
  }
}

/** A plugin, to register tools and sections on and then run. */
export function plugin(options: PluginOptions): Plugin {
  return new Builder(options);
}
