/**
 * The plugin's wiring: the Pull requests section, its actions and what
 * the app tells it, joined to the watch, over the streams it is given.
 */

import { plugin, type RunOptions } from "@elva-labs/workbench-plugin";
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

/** Runs the plugin until the app stops it or the input ends. */
export async function serve(options: RunOptions = {}): Promise<void> {
  const p = plugin({ name: "github", version: "0.1.0" });

  const watch = new Watch({
    gh,
    remotes,
    store: new Store(),
    clock,
    out: {
      fold: (project, session) => void p.refresh(SECTION, project, session),
      mark: (project, session, tally) =>
        p.mark(project, session, markOf(tally)),
      notify: (project, session, text) => p.notify(project, text, session),
    },
  });

  p.section(SECTION, {
    title: TITLE,
    actions: ({ session }) => headerOf(watch.viewOf(session)),
    detail: ({ session }) => detailOf(watch.viewOf(session)),
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
  await p.run(options);
}
