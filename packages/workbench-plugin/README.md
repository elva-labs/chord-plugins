# @elva-labs/workbench-plugin

Chord runs a plugin as one process that speaks JSON lines over
its standard input and output. This package holds the types for those
lines and the loop that reads and writes them, so a plugin is a handler
per name rather than a switch over a stream.

```
npm install @elva-labs/workbench-plugin
```

## Writing a plugin

A plugin declares what it offers, registers a handler for each name, and
runs. The loop greets the app with the tools and the sections, answers
every call under the id it came with, and keeps going until the app asks
it to stop.

```js
import { plugin } from "@elva-labs/workbench-plugin";

const p = plugin({ name: "github", version: "0.2.0" });

p.tool(
  "pr",
  { description: "The branch's pull request, its checks and its comments." },
  ({ state }, { project }) => summarise(project, state),
);

p.section("pull-request", {
  title: "Pull request",
  actions: [{ id: "refresh", label: "Refresh" }],
  rows: async ({ project }) =>
    (await checks(project)).map((check) => ({
      id: check.name,
      label: check.name,
      state: check.conclusion === "success" ? "ok" : "failed",
      actions: [{ id: "open", label: "Open" }],
      default: "open",
    })),
});

p.action("pull-request", "open", ({ row, project }) =>
  p.open(project, { path: `.github/workflows/${row.id}.yml`, from: 1 }),
);

p.on("tree", ({ project }) => p.refresh("pull-request", project));

p.run();
```

## What the builder offers

- `tool(name, { description, inputSchema }, handler)` registers a tool the
  agent can call. What the handler returns is the call's content, a string
  as it is and anything else as JSON. What it throws is the error the agent
  reads.
- `section(id, { title, actions, detail, folded, rows })` registers a
  section under the tree. The rows are computed for one project at a time,
  on every project that is open when the app greets the plugin, on every
  project that opens after that, and whenever `refresh(id, project)` is
  called. `detail` is asked alongside them for a short line beside the
  section's title, and a detail that is empty or that could not be found is
  a section with none. `folded: true` starts the section folded where the
  app draws it as a group of its own. A row's `facts`, up to eight of
  `{ label, text, state }`, make it a row that opens to list them.
- `refresh(id, project, session)` sends a section for one session instead
  of the whole project, which the app shows while that session is in front
  in place of the project's section with the same id. The rows, the header
  and the detail are asked with `{ project, session }`, the session null
  for the project's own. A section with no rows, no actions and no detail
  is taken away.
- `action(section, action, handler)` registers what one of a section's
  actions does. The handler is given the row it was taken on, the input
  the app asked for and the session whose section it was, or null, and the
  section is sent again once it is done. `openUrl(url)` on what the handler
  is given opens one http or https address in the user's browser for that
  action, which is the only time the app opens one.
- `palette(id, { label, when }, handler)` registers a command in the app's
  palette, whose id the manifest lists under `palette`, eight at most. The
  label is one line of 60 characters at most that starts with a capital or a
  digit, and the app lists none named like a command of its own. The
  commands are sent for each project that is open, leaving out those whose
  `when({ project })` says no, and taken away when it closes.
  `refreshPalette(project)` asks `when` again. The handler is given the
  pick's `id`, `project`, the session in front or null, and
  `openUrl(url)`; `start`, `send` and `view` with `open: true` act on it
  too, with the `id` where one is asked for. The app waits 10 seconds, and
  what the handler throws is shown to the user.
- `on(event, handler)` listens for a project opening or closing, a session
  starting, changing state or ending, a tree that moved, a message from the
  plugin's page, a command a session ran that the manifest's `commands`
  asks to hear, or the request to stop. A session's event says the folder
  it runs in, whether that is a worktree the app made for it and on which
  branch, and the session that started it.
- `open`, `diff`, `present` and `notify` show a place in the viewer, a
  file's diff, media, or a line on a session's row, the same means the
  agent has. `notify(project, text, null, target)` names no session and is
  the plugin's own notification: a click on it opens the plugin's page,
  which is handed the target.
- What the user does reaches the plugin with an id: an action's, or the
  first message of a click or a key in the page, as the `id` on its
  `view_message`. Within 30 seconds the plugin may answer it once each with
  `openUrl(project, id, url)`, with `start(project, id, { prompt, name,
ref, worktree, purpose, agent })`, which the app puts to the user on its
  card before anything starts, and with `send(id, session, text)` to a
  session the plugin started. A started session's lines carry its `ref`,
  and what came of a send arrives at `on("sent", handler)`: `delivered`,
  `gone` or `refused`. A prompt or a line that begins with `/` or `!`, or
  that is longer than the app takes, is refused where it is made.
- `mark(project, session, { icon, count, state, label })` puts the
  plugin's one mark on a session's row, in place of the last one, and
  `mark(project, session, null)` takes it away.
- `view(project, { html, path, open })` sends the plugin's page for a
  project, written out or read from a file of the plugin's own directory,
  and `viewData(project, data)` sends that page a message while it is open.
  What the page sends back arrives at `on("view_message", handler)`. The
  page's side of the bridge, `window.workbench` with its `context`,
  `onContext`, `onTarget`, `send`, `onData`, `open`, `agent` and `show`, is
  typed as `Workbench`, and what it is told about the theme as
  `PageContext`. A
  plugin with a page says how much room it asks for when it is made,
  `plugin({ name, version, view: "full" })`, the same word its manifest
  says.
- `run()` reads standard input and writes standard output, and resolves
  when the app asks the plugin to stop or the input ends. Calls are handled
  as they arrive, a handler that fails answers with its error and nothing
  more, and a line the plugin does not know is left alone.

Every name a plugin registers is a plain identifier: a lowercase letter
first, then lowercase letters, digits, dashes and underscores. A name that
is not is refused where it is registered.

Node 20 or newer. The package has no dependencies of its own.
