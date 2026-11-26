/**
 * The plugin's wiring: the Pull requests section, its actions, the page
 * of reviews asked and what the app tells it, joined to the watch and the
 * offers, over the streams it is given.
 */

import { plugin, type RunOptions } from "@elva-labs/workbench-plugin";
import {
  askRows,
  confirmed,
  detailOf,
  GUIDE,
  GUIDE_URL,
  headerOf,
  heardOf,
  keyOfReviewRow,
  keyOfRow,
  markOf,
  MERGE,
  OPEN,
  REFRESH,
  reviewRows,
  rowsOf,
  SECTION,
  sessionOf,
  TITLE,
  VIEW,
} from "./app.js";
import { gh } from "./gh.js";
import { Offers } from "./offers.js";
import { page } from "./page.js";
import { Pauses } from "./pauses.js";
import { remotes } from "./place.js";
import { Reviews } from "./reviews.js";
import { clock } from "./schedule.js";
import { Store } from "./store.js";
import { Watch } from "./watch.js";

/** Runs the plugin until the app stops it or the input ends. */
export async function serve(options: RunOptions = {}): Promise<void> {
  const p = plugin({ name: "github", version: "0.1.0", view: "wide" });
  const pauses = new Pauses();

  const watch = new Watch({
    gh,
    remotes,
    store: new Store(),
    clock,
    pauses,
    out: {
      fold: (project, session) => void p.refresh(SECTION, project, session),
      mark: (project, session, tally) =>
        p.mark(project, session, markOf(tally)),
      notify: (project, session, text) => p.notify(project, text, session),
    },
  });

  const offers = new Offers({
    gh,
    remotes,
    clock,
    pauses,
    reviews: new Reviews(),
    out: {
      notify: (project, text, target) => p.notify(project, text, null, target),
      fold: (project, session) => void p.refresh(SECTION, project, session),
      data: (project, data) => p.viewData(project, data),
      start: (project, answers, session) => p.start(project, answers, session),
      send: (answers, session, text) => p.send(answers, session, text),
      openUrl: (project, answers, url) => p.openUrl(project, answers, url),
    },
  });

  const opened = (project: string): void => {
    p.view(project, { html: page() });
    void offers.opened(project);
  };

  p.section(SECTION, {
    title: TITLE,
    actions: ({ session }) => headerOf(watch.viewOf(session)),
    detail: ({ session }) => {
      const view = watch.viewOf(session);
      const detail = detailOf(view);
      if (detail !== null || session === null) return detail;
      return offers.reviewedBy(session).length > 0 ? "reviewing" : null;
    },
    rows: ({ project, session }) => [
      ...rowsOf(watch.viewOf(session)),
      ...(session === null
        ? []
        : [
            ...reviewRows(offers.reviewedBy(session)),
            ...askRows(offers.asksFor(project)),
          ]),
    ],
  });

  p.action(SECTION, OPEN, ({ row, session, openUrl }) => {
    const review = keyOfReviewRow(row?.id);
    if (review !== null) {
      const url = offers.askOf(review)?.url;
      if (url !== undefined) openUrl(url);
      return;
    }
    openUrl(watch.urlOf(session, keyOfRow(row?.id)));
  });

  p.action(SECTION, MERGE, async ({ row, session, input }) => {
    if (!confirmed(input)) return;
    await watch.merge(session, keyOfRow(row?.id));
  });

  p.action(SECTION, GUIDE, ({ openUrl }) => openUrl(GUIDE_URL));

  p.action(SECTION, REFRESH, async () => {
    await Promise.all([watch.refresh(), offers.refresh()]);
  });

  p.action(SECTION, VIEW, ({ project }) => {
    p.view(project, { html: page(), open: true });
  });

  p.on("hello", (event) => {
    for (const project of event.projects) opened(project);
  });

  p.on("project", (event) => {
    if (event.event === "opened") opened(event.path);
    else offers.closed(event.path);
  });

  p.on("session", (event) => {
    const told = sessionOf(event);
    if (told === null) return;
    if (told.ended) {
      watch.ended(told.session.id);
      offers.ended(told.session.id);
    } else {
      watch.told(told.session);
      offers.told(told.session.id, told.session.project, told.ref);
    }
  });

  p.on("command", (event) => watch.heard(heardOf(event)));

  p.on("view_message", (event) => {
    offers.message(event.project, event.payload, event.id ?? null);
  });

  p.on("sent", (event) => offers.sent(event.answers, event.outcome));

  p.on("stop", () => {
    watch.stop();
    offers.stop();
  });

  await Promise.all([watch.start(), offers.start()]);
  await p.run(options);
}
