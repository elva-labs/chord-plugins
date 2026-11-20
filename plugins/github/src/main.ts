/**
 * The github plugin: the pull requests of a session, as the Pull requests
 * fold under it and a mark on its row, kept fresh from gh and told of on
 * the row when they change.
 */

import { plugin } from "@elva-labs/workbench-plugin";
import {
  confirmed,
  detailOf,
  headerOf,
  heardOf,
  keyOfRow,
  markOf,
  MERGE,
  OPEN,
  REFRESH,
  rowsOf,
  SECTION,
  sessionOf,
  TITLE,
} from "./app.js";
import { gh } from "./gh.js";
import { remotes } from "./place.js";
import { clock } from "./schedule.js";
import { Store } from "./store.js";
import { Watch } from "./watch.js";

const p = plugin({ name: "github", version: "0.1.0" });

const watch = new Watch({
  gh,
  remotes,
  store: new Store(),
  clock,
  out: {
    fold: (project, session) => void p.refresh(SECTION, project, session),
    mark: (project, session, tally) => p.mark(project, session, markOf(tally)),
    notify: (project, session, text) => p.notify(project, text, session),
  },
});

p.section(SECTION, {
  title: TITLE,
  actions: ({ session }) => headerOf(watch.viewOf(session)),
  detail: ({ session }) => detailOf(watch.viewOf(session), clock.now()),
  rows: ({ session }) => rowsOf(watch.viewOf(session)),
});

p.action(SECTION, OPEN, ({ row, session, openUrl }) => {
  openUrl(watch.urlOf(session, keyOfRow(row?.id)));
});

p.action(SECTION, MERGE, async ({ row, session, input }) => {
  if (!confirmed(input)) return;
  await watch.merge(session, keyOfRow(row?.id));
});

p.action(SECTION, REFRESH, () => watch.refresh());

p.on("session", (event) => {
  const told = sessionOf(event);
  if (told === null) return;
  if (told.ended) watch.ended(told.session.id);
  else watch.told(told.session);
});

p.on("command", (event) => watch.heard(heardOf(event)));

p.on("stop", () => watch.stop());

await watch.start();
await p.run();

// The loop is over, and standard input is what holds the process up, so
// letting go of it is the plugin going when it was told to.
process.stdin.unref();
