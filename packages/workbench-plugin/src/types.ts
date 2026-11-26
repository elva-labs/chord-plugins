/**
 * The messages the app and a plugin send each other, one JSON object per
 * line, every one of them with a `type`.
 */

/** The state a row's dot is drawn in. */
export type RowState = "ok" | "busy" | "waiting" | "failed";

/** One of the named options a choice offers. */
export interface Choice {
  id: string;
  label: string;
}

/** What an action asks for before it runs: a line of text, or a choice. */
export interface Field {
  id: string;
  label: string;
  kind: "text" | "choice";
  options?: Choice[];
  placeholder?: string;
}

/**
 * Something the user can have the plugin do, on a row or on a section's
 * header. An action with fields is asked about first.
 */
export interface Action {
  id: string;
  label: string;
  input?: Field[];
}

/** One thing a row says about itself, listed under it when it opens: a
    label, a line of text after it and a dot in a state. */
export interface Fact {
  label: string;
  text?: string | null;
  state?: RowState | null;
}

/** A line of a section, as the tree draws it. */
export interface Row {
  id: string;
  label: string;
  detail?: string;
  state?: RowState;
  actions?: Action[];
  /** Which of the row's actions Enter runs. */
  default?: string;
  /** Up to eight facts, which make the row one that opens. */
  facts?: Fact[];
}

/** A tool the agent called, with the session that called it. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  project: string;
  session: string | null;
}

/** An action the user took, with the row it was on and any input given. */
export interface ActionCall {
  id: string;
  section: string;
  action: string;
  /** The row's id, or null for an action on the section's header. */
  row: string | null;
  input: Record<string, string>;
  project: string;
  /** The session whose section the action was on, and none on a
      project's section. */
  session?: string | null;
}

/** The app's greeting: its version, and the projects open on the machine. */
export interface HelloEvent {
  type: "hello";
  app: string;
  projects: string[];
}

/** A project opened or closed on the machine. */
export interface ProjectEvent {
  type: "project";
  event: "opened" | "closed";
  path: string;
}

/** A session started, changed state or ended. */
export interface SessionEvent {
  type: "session";
  event: "started" | "ended" | "state";
  /** The agent's own id for the session, which every other message names
      it by. */
  id: string;
  project: string;
  state?: string;
  /** The folder the session runs in. */
  cwd?: string;
  /** Whether `cwd` is a worktree the app made for this very session. */
  worktree?: boolean;
  /** The branch that worktree was made on, there only when `worktree` is
      true and the app knows it. */
  branch?: string;
  /** The session that started this one, while the window still knows
      it. */
  startedBy?: string;
  /** The ref the plugin gave the start that began this session, on the
      lines of its own sessions only and kept across resumes. */
  ref?: string;
}

/** A command a session ran that begins with one of the words the
    plugin's manifest lists, once it has finished. */
export interface CommandEvent {
  type: "command";
  project: string;
  /** The agent's id for the session that ran it. */
  session: string;
  /** The folder it ran in. */
  cwd: string;
  /** The matched command's own words, from its program to its last
      word, without the rest of the line it ran in. */
  command: string;
  /** Whether the line it ran in succeeded. */
  ok: boolean;
  /** The end of what the line printed, at most 16 KiB, or null when
      another command in the line prints too. */
  output: string | null;
  /** Whether it printed more than `output` holds. */
  truncated: boolean;
  /** Whether `output` is held back because another command in the line
      prints too. */
  withheld: boolean;
}

/** The tree of a project moved. */
export interface TreeEvent {
  type: "tree";
  project: string;
}

/** The app is asking the plugin to go. */
export interface StopEvent {
  type: "stop";
}

/** Something the plugin's page sent, for the project it is open on. */
export interface ViewMessageEvent {
  type: "view_message";
  project: string;
  payload: unknown;
  /** Present on the first message of a click or a key in the page: the id
      a start, a send or a web address may answer. */
  id?: string;
}

/** What came of a line the plugin sent one of its sessions. */
export interface SentEvent {
  type: "sent";
  /** The id the send answered. */
  answers: string;
  session: string;
  /** `delivered` when the session has the line, `gone` when it will not
      come back or is not the plugin's, `refused` when the line was not put
      to it and may be sent again later. */
  outcome: "delivered" | "gone" | "refused";
}

/** A palette command the user picked: the id to answer, the command, the
    project on screen and the session in front of the user, when one is. */
export interface PickCall {
  id: string;
  command: string;
  project: string;
  session?: string | null;
}

/** Everything that arrives on standard input. */
export type AppMessage =
  | HelloEvent
  | ProjectEvent
  | SessionEvent
  | TreeEvent
  | StopEvent
  | ViewMessageEvent
  | SentEvent
  | CommandEvent
  | ({ type: "tool" } & ToolCall)
  | ({ type: "action" } & ActionCall)
  | ({ type: "pick" } & PickCall);

/** A tool as the greeting declares it. */
export interface DeclaredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A section as the greeting declares it. */
export interface DeclaredSection {
  id: string;
  title: string;
  actions: Action[];
  /** Whether the section starts folded where the app draws it as a group
      of its own. */
  folded?: boolean;
}

/** The view as the greeting declares it: the room the page asks for, the
    same word the manifest says. */
export interface DeclaredView {
  /** "wide" is the viewer beside the tree, "full" the whole pane. */
  width: "wide" | "full";
}

/** The plugin's greeting: its name, its version and what it offers. */
export interface Greeting {
  type: "hello";
  name: string;
  version: string;
  tools: DeclaredTool[];
  sections: DeclaredSection[];
  view: DeclaredView | null;
}

/** The answer to a tool call or an action, under the same id. */
export interface Result {
  type: "result";
  id: string;
  content?: string;
  error?: string;
}

/** A section's rows for one project, or for one of its sessions. */
export interface SectionLine {
  type: "section";
  id: string;
  title: string;
  project: string;
  /** The session the section is for, and none for the whole project. */
  session?: string;
  rows: Row[];
  actions: Action[];
  /** A short line drawn beside the section's title. */
  detail?: string;
  /** Whether the section starts folded where the app draws it as a group
      of its own. */
  folded?: boolean;
}

/** A place to open in the viewer. */
export interface OpenLine {
  type: "open";
  project: string;
  path: string;
  from: number;
  to?: number;
  note?: string;
}

/** A file's diff, shown in the changes pane. */
export interface DiffLine {
  type: "diff";
  project: string;
  path: string;
  note?: string;
}

/** Media to present. */
export interface PresentLine {
  type: "present";
  project: string;
  files: string[];
  caption?: string;
}

/** A line for a session's row, or with no session the plugin's own
    notification, which opens its page with the target when clicked. */
export interface NotifyLine {
  type: "notify";
  project: string;
  text: string;
  session?: string | null;
  /** What the page is handed when the notification opens it, 256 bytes at
      most. A newer notification with the same target replaces the last. */
  target?: string;
}

/** The icons a mark can carry. */
export type MarkIcon =
  "pull-request" | "branch" | "issue" | "check" | "comment" | "dot";

/** What a mark on a session's row says: an icon, a count, the state that
    tints it and the words hovering it shows. */
export interface Mark {
  icon: MarkIcon;
  count?: number;
  state?: RowState | null;
  label?: string;
}

/** The plugin's one mark on a session's row, or no icon to take it
    away. */
export interface MarkLine {
  type: "mark";
  project: string;
  session: string;
  icon: MarkIcon | null;
  count?: number;
  state?: RowState | null;
  label?: string;
}

/** A web address to open in the user's browser, for the action it
    answers while that action waits for its result, or for an id it
    answers within 30 seconds. */
export interface OpenUrlLine {
  type: "open_url";
  project: string;
  /** The id of the action it answers, as the action message gave it. */
  action?: string;
  /** The id it answers, an action's or a page message's. */
  answers?: string;
  url: string;
}

/** A session to start, put to the user on the app's card first. */
export interface StartLine {
  type: "start";
  answers: string;
  project: string;
  prompt: string;
  name?: string;
  ref?: string;
  worktree?: boolean;
  purpose?: "review";
  agent?: string;
}

/** A line for a session the plugin started. */
export interface SendLine {
  type: "send";
  answers: string;
  session: string;
  text: string;
}

/** The plugin's page for one project, written out or read from a file of
    the plugin's own directory. */
export interface ViewLine {
  type: "view";
  project: string;
  html?: string;
  path?: string;
  /** Whether the app shows the page now. */
  open?: boolean;
}

/** A message for the page the plugin has for a project, which reaches it
    while it is open and is kept nowhere. */
export interface ViewDataLine {
  type: "view_data";
  project: string;
  data: unknown;
}

/** A command as the app's palette lists it. */
export interface PaletteCommand {
  id: string;
  label: string;
}

/** Every palette command the plugin offers for one open project, in place
    of the last such line. An empty list takes them away. */
export interface PaletteLine {
  type: "palette";
  project: string;
  commands: PaletteCommand[];
}

/** Everything the plugin writes to standard output. */
export type PluginMessage =
  | Greeting
  | Result
  | SectionLine
  | OpenLine
  | DiffLine
  | PresentLine
  | NotifyLine
  | MarkLine
  | OpenUrlLine
  | StartLine
  | SendLine
  | ViewLine
  | ViewDataLine
  | PaletteLine;

/** Where to open, as the `open` helper takes it. */
export interface OpenOptions {
  path: string;
  from: number;
  to?: number;
  note?: string;
}

/** Which file to diff, as the `diff` helper takes it. */
export interface DiffOptions {
  path: string;
  note?: string;
}

/** What to present, as the `present` helper takes it. */
export interface PresentOptions {
  files: string[];
  caption?: string;
}

/** The page to send, as the `view` helper takes it: the html itself, or a
    file of the plugin's own directory to read it from. */
export interface ViewOptions {
  html?: string;
  path?: string;
  open?: boolean;
}

/** A session to start, as the `start` helper takes it. */
export interface StartOptions {
  /** The session's first message, 8 KiB at most, never beginning with
      `/` or `!`. */
  prompt: string;
  /** The session's name until its harness gives it one, one line of 60
      characters at most. */
  name?: string;
  /** Handed back on the session's lines to this plugin alone, 256 bytes
      at most. */
  ref?: string;
  /** Whether the session runs in a worktree of its own. */
  worktree?: boolean;
  /** What the session is for. A review begins the card on the agent the
      user picked for the last one. */
  purpose?: "review";
  /** The title of the agent the card suggests, 256 bytes at most. */
  agent?: string;
}

/** The theme's colours, fonts and radii by name, as the page is told
    them and as `--workbench-<name>` properties on its root. */
export interface ThemeTokens {
  bg: string;
  surface: string;
  "surface-2": string;
  well: string;
  ink: string;
  "ink-2": string;
  "ink-3": string;
  rule: string;
  "rule-strong": string;
  accent: string;
  "accent-soft": string;
  add: string;
  del: string;
  mono: string;
  sans: string;
  radius: string;
  "radius-sm": string;
}

/** What is around the page: the session on screen when it is one of the
    page's project, the scheme and look the app paints, and its theme. */
export interface PageContext {
  session: string | null;
  scheme: "light" | "dark";
  look: "modern" | "terminal";
  tokens: ThemeTokens;
}

/** The bridge the app gives a plugin's page as `window.workbench`. */
export interface Workbench {
  /** The latest context, null until the first arrives. */
  context: PageContext | null;
  /** Receives each context, the latest at once when there is one. */
  onContext(fn: (context: PageContext) => void): void;
  /** Receives the target of the notification that opened the page, even
      when the handler is set after it arrived. */
  onTarget(fn: (target: string) => void): void;
  /** Sends the plugin a message. The first of a click or a key carries an
      id the plugin may answer. */
  send(payload: unknown): void;
  /** Receives what the plugin sends the page. */
  onData(fn: (data: unknown) => void): void;
  /** Opens a file of the project in the viewer, at lines. */
  open(path: string, from?: number, to?: number, note?: string | null): void;
  /** Puts text on the agent's prompt line, unsent. */
  agent(text: string): void;
  /** Brings a session of the page's project on screen, only as the first
      message of a click or a key. */
  show(session: string): void;
}
