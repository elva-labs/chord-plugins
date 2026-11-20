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
  Mark,
  OpenOptions,
  PluginMessage,
  PresentOptions,
  ProjectEvent,
  Row,
  SessionEvent,
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

/** The events a plugin can listen for. */
export interface Events {
  project: ProjectEvent;
  session: SessionEvent;
  command: CommandEvent;
  tree: TreeEvent;
  stop: StopEvent;
  view_message: ViewMessageEvent;
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
  /** Opens a place in the viewer. */
  open(project: string, place: OpenOptions): void;
  /** Shows a file's diff. */
  diff(project: string, file: DiffOptions): void;
  /** Presents media. */
  present(project: string, media: PresentOptions): void;
  /** Puts a line on a session's row. */
  notify(project: string, text: string, session?: string): void;
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

  open(project: string, place: OpenOptions): void {
    this.#write({ type: "open", project, ...place });
  }

  diff(project: string, file: DiffOptions): void {
    this.#write({ type: "diff", project, ...file });
  }

  present(project: string, media: PresentOptions): void {
    this.#write({ type: "present", project, ...media });
  }

  notify(project: string, text: string, session?: string): void {
    this.#write({
      type: "notify",
      project,
      text,
      ...(session ? { session } : {}),
    });
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
        await this.#refreshAll();
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
      default:
        return;
    }
  }

  async #project(event: ProjectEvent): Promise<void> {
    if (event.event === "opened") {
      this.#projects.add(event.path);
    } else {
      this.#projects.delete(event.path);
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
    await Promise.all(
      [...this.#sections.keys()].map((section) =>
        this.refresh(section, event.path),
      ),
    );
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
    let opened = false;
    const openUrl = (url: string): void => {
      if (answered) throw new Error("the action has already been answered");
      if (opened) throw new Error("an action opens one web address");
      if (!openable(url)) {
        throw new Error(`not a web address the app opens: ${url}`);
      }
      opened = true;
      this.#write({
        type: "open_url",
        id: call.id,
        project: call.project,
        url,
      });
    };
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
