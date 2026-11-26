/**
 * The page the viewer shows: the reviews asked of the user, one row each,
 * with what can be done about it. As a project's overview it shows one
 * repository, with the user's own open pull requests there first. The page
 * holds no data of its own. It
 * asks the plugin for what it shows once it has loaded and draws each
 * message that comes, and every word from GitHub goes onto it as text,
 * never as markup. Its colours are the app's theme, read from the custom
 * properties the app sets on the page's root, with the app's own dark and
 * light as they stand where those are missing.
 *
 * A button sends the plugin one message, as the first of its click, so
 * the plugin may answer it with a start, a send or a web address; Go to
 * session and Read review bring the session on screen instead.
 */

/** The page, as the plugin sends it. */
export function page(): string {
  return `<style>${STYLE}</style>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">${ICONS}</svg>
<main class="ovw">
  <div class="ov-top">
    <h2>Pull requests</h2>
    <span class="upd"><span id="updated"></span><button id="refresh" type="button">${icon("refresh", "i s")}Refresh</button></span>
  </div>
  <div class="ov-trouble" id="trouble" hidden><span class="w">Trouble</span><span id="trouble-text"></span><span class="btns"><button class="btn" id="again" type="button">Try again</button></span></div>
  <p class="scope" id="scope" hidden><span id="scope-text"></span><button class="btn" id="all" type="button">Show all repositories</button></p>
  <section class="grp" id="mine" hidden>
    <h3>Your pull requests <span id="mine-count">0</span></h3>
    <div id="mine-rows"></div>
  </section>
  <section class="grp" id="asks">
    <h3>Review requested <span id="count">0</span></h3>
    <div id="rows"></div>
  </section>
</main>
<script>${SCRIPT}</script>`;
}

function icon(name: string, cls = "i"): string {
  return `<svg class="${cls}"><use href="#${name}"/></svg>`;
}

const ICONS = `
<symbol id="tick" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></symbol>
<symbol id="x" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></symbol>
<symbol id="run" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" stroke-dasharray="2.4 2.2"/></symbol>
<symbol id="person" viewBox="0 0 16 16"><circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.5c.8-2.6 2.7-3.8 5-3.8s4.2 1.2 5 3.8"/></symbol>
<symbol id="refresh" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5"/></symbol>
<symbol id="ext" viewBox="0 0 16 16"><path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5"/></symbol>
<symbol id="dash" viewBox="0 0 16 16"><path d="M5 8h6"/></symbol>`;

/** The app's tokens where it sets them, and its own dark and light where
    it does not. */
const STYLE = `
:root {
  color-scheme: dark;
  --bg: var(--workbench-bg, #12100f);
  --surface: var(--workbench-surface, #1b1618);
  --surface-2: var(--workbench-surface-2, #201b1e);
  --ink: var(--workbench-ink, #e6eae9);
  --ink-2: var(--workbench-ink-2, #b3a6ac);
  --ink-3: var(--workbench-ink-3, #857a80);
  --rule: var(--workbench-rule, #2e262a);
  --rule-strong: var(--workbench-rule-strong, #433840);
  --accent: var(--workbench-accent, #ec8fb3);
  --accent-soft: var(--workbench-accent-soft, #341a26);
  --add: var(--workbench-add, #7fbf8c);
  --del: var(--workbench-del, #e08894);
  --dormant: #d8b45e;
  --sans: var(--workbench-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif);
  --mono: var(--workbench-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  --radius: var(--workbench-radius, 7px);
  --divider: color-mix(in srgb, var(--surface) 82%, var(--ink) 18%);
}
:root[data-scheme="light"] { color-scheme: light; --dormant: #8a6a1f; }
@media (prefers-color-scheme: light) {
  :root:not([data-scheme]) {
    color-scheme: light;
    --bg: var(--workbench-bg, #f7f4f6);
    --surface: var(--workbench-surface, #ffffff);
    --surface-2: var(--workbench-surface-2, #f1ebee);
    --ink: var(--workbench-ink, #14181a);
    --ink-2: var(--workbench-ink-2, #5a4f55);
    --ink-3: var(--workbench-ink-3, #897d84);
    --rule: var(--workbench-rule, #e7dde2);
    --rule-strong: var(--workbench-rule-strong, #d0c3c9);
    --accent: var(--workbench-accent, #b0426b);
    --accent-soft: var(--workbench-accent-soft, #f8e6ee);
    --add: var(--workbench-add, #2e6b3f);
    --del: var(--workbench-del, #9b3a47);
    --dormant: #8a6a1f;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--ink); font: 13px/1.5 var(--sans); -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
button:focus-visible, .ttl:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
[hidden] { display: none !important; }
svg.i { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex: none; }
svg.s { width: 12px; height: 12px; }
.ovw { padding: 16px 22px 40px; }
.ov-top { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
.ov-top h2 { margin: 0; font-size: 14px; font-weight: 600; }
.ov-top .upd { margin-left: auto; color: var(--ink-3); font-size: 12px; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.ov-top .upd button { color: var(--ink-2); display: flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 5px; }
.ov-top .upd button:hover { background: var(--surface-2); color: var(--accent); }
.ov-trouble { margin: 8px 0 0; padding: 7px 10px; border-radius: var(--radius); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--del) 45%, transparent); font-size: 12px; color: var(--ink-2); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ov-trouble .w { color: var(--del); font-weight: 600; }
.ov-trouble .btns { margin-left: auto; display: flex; gap: 6px; }
.scope { margin: 6px 0 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--ink-3); }
.grp { margin-top: 16px; }
.grp h3 { margin: 0 0 4px; font-size: 12px; font-weight: 600; color: var(--ink-2); display: flex; gap: 6px; }
.grp h3 span { color: var(--ink-3); font-weight: 400; }
.pdot { width: 7px; height: 7px; flex: none; border: 1px solid var(--ink-3); border-radius: 50%; }
.pdot[data-state="ok"] { background: var(--add); border-color: var(--add); }
.pdot[data-state="busy"] { background: var(--ink-3); animation: breathe 1.2s ease-in-out infinite; }
.pdot[data-state="waiting"] { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.pdot[data-state="failed"] { background: var(--del); border-color: var(--del); }
@keyframes breathe { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .pdot[data-state="busy"] { animation: none; } }
.dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--dormant); }
.orow { display: grid; grid-template-columns: 8px minmax(0, 1fr) 150px 200px minmax(236px, max-content); column-gap: 14px; align-items: center; padding: 7px 10px; border-radius: var(--radius); border-top: 1px solid var(--divider); transition: background .6s; }
.orow:first-child { border-top: 0; }
.orow:hover { background: var(--surface-2); }
.orow.hl { background: var(--accent-soft); transition: none; }
.orow .ttl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12.5px; color: var(--ink); font-weight: 500; }
.orow .ttl em { font-style: normal; color: var(--ink-3); font-weight: 400; margin-left: 6px; }
.orow .ttl[data-open]:hover { text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.orow .sub { font-size: 11.5px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.orow .sub .host { opacity: .85; }
.orow .cell { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); white-space: nowrap; overflow: hidden; }
.orow .cell span { overflow: hidden; text-overflow: ellipsis; }
.orow .cell svg { width: 12px; height: 12px; color: var(--ink-3); }
.orow .cell.ok svg { color: var(--add); }
.orow .cell.fail { color: var(--del); }
.orow .cell.fail svg { color: var(--del); }
.orow .cell.you, .orow .cell.ready { color: var(--accent); font-weight: 500; }
.orow .cell.you svg, .orow .cell.ready svg { color: var(--accent); }
.orow .cell.two { display: grid; grid-template-columns: 12px minmax(0, 1fr); column-gap: 6px; row-gap: 1px; }
.orow .cell.two .in { grid-column: 2; display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 11.5px; font-weight: 400; color: var(--ink-3); }
.orow .acts { display: flex; justify-content: flex-end; align-items: center; gap: 6px; min-width: 0; }
.orow .acts .quiet { font-size: 11.5px; color: var(--ink-3); white-space: nowrap; }
.orow .acts .nop { position: relative; text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
.orow .acts .nop .tip { display: none; position: absolute; right: 0; top: calc(100% + 8px); z-index: 4; width: 290px; padding: 7px 10px; border-radius: calc(var(--radius) + 1px); background: var(--surface); color: var(--ink-2); font-size: 11.5px; line-height: 1.45; white-space: normal; box-shadow: 0 0 0 1px var(--divider), 0 10px 26px color-mix(in srgb, black 24%, transparent); }
.orow .acts .nop:hover .tip, .orow .acts .nop:focus .tip { display: block; }
.btn { white-space: nowrap; height: 26px; padding: 0 11px; border-radius: var(--radius); font-size: 12px; font-weight: 500; box-shadow: inset 0 0 0 1px var(--rule-strong); display: inline-flex; align-items: center; gap: 5px; }
.btn:hover { background: var(--surface-2); }
.btn.offer { color: var(--accent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, var(--rule-strong)); }
.btn.offer:hover { background: var(--accent); color: var(--bg); box-shadow: none; }
.btn.offer.pressed { background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.empty { padding: 14px 10px; display: flex; align-items: center; gap: 8px; color: var(--ink-3); font-size: 12.5px; border-top: 1px solid var(--divider); }
.empty svg { color: var(--add); }
@media (max-width: 760px) {
  .orow { grid-template-columns: 8px minmax(0, 1fr) 170px minmax(236px, max-content); }
  .orow .ck { display: none; }
}
@media (max-width: 520px) {
  .orow { grid-template-columns: 8px minmax(0, 1fr) auto; }
  .orow .rv { display: none; }
}
`;

/** The page's script. It builds every node with createElement and puts
    every word into textContent. */
const SCRIPT = `
(function () {
  var bridge = window.workbench;
  var rowsEl = document.getElementById("rows");
  var countEl = document.getElementById("count");
  var updatedEl = document.getElementById("updated");
  var troubleEl = document.getElementById("trouble");
  var troubleText = document.getElementById("trouble-text");
  var scopeEl = document.getElementById("scope");
  var scopeText = document.getElementById("scope-text");
  var mineEl = document.getElementById("mine");
  var mineRows = document.getElementById("mine-rows");
  var mineCount = document.getElementById("mine-count");
  var shown = null;
  var target = null;

  function send(payload) { if (bridge) bridge.send(payload); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(name) {
    var ns = "http://www.w3.org/2000/svg";
    var node = document.createElementNS(ns, "svg");
    node.setAttribute("class", "i s");
    var use = document.createElementNS(ns, "use");
    use.setAttribute("href", "#" + name);
    node.appendChild(use);
    return node;
  }

  function cell(kind, name, text, cls) {
    var node = el("div", "cell " + kind + " " + cls);
    node.appendChild(svg(name));
    node.appendChild(el("span", "", text));
    return node;
  }

  function button(label, cls, onClick, name) {
    var node = el("button", "btn " + cls);
    node.type = "button";
    if (name) node.appendChild(svg(name));
    node.appendChild(document.createTextNode(label));
    node.addEventListener("click", function () {
      onClick();
      node.classList.add("pressed");
    });
    return node;
  }

  function ago(at) {
    var minutes = Math.floor((Date.now() - at) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes + "m";
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h";
    return Math.floor(hours / 24) + "d";
  }

  function updated(at) {
    if (typeof at !== "number") return "";
    var minutes = Math.floor((Date.now() - at) / 60000);
    if (minutes < 1) return "Updated just now";
    if (minutes < 60) return "Updated " + minutes + " min ago";
    var date = new Date(at);
    var two = function (n) { return String(n).padStart(2, "0"); };
    return "Updated " + two(date.getHours()) + ":" + two(date.getMinutes());
  }

  function dotOf(row) {
    if (row.checks.failed > 0) return "failed";
    if (row.checks.running > 0) return "busy";
    if (row.standing === "requested" || row.standing === "again" || row.standing === "again-new" || row.standing === "none") return "waiting";
    return "ok";
  }

  function checksOf(row) {
    var c = row.checks;
    if (c.failed > 0) return cell("fail", "x", c.failed + " failed" + (c.passed > 0 ? ", " + c.passed + " passed" : ""), "ck");
    if (c.running > 0) return cell("", "run", c.running + " running" + (c.passed > 0 ? ", " + c.passed + " passed" : ""), "ck");
    if (c.passed > 0) return cell("ok", "tick", c.passed + " passed", "ck");
    return cell("", "dash", "No checks", "ck");
  }

  function reviewOf(row) {
    switch (row.standing) {
      case "reviewing": return cell("", "run", "Reviewing", "rv");
      case "ready": return cell("ready", "tick", "Review ready to read", "rv");
      case "again-new": return cell("you", "person", "Re-review requested", "rv");
      case "again": {
        var node = el("div", "cell you two rv");
        node.appendChild(svg("person"));
        node.appendChild(el("span", "", "Re-review requested"));
        var into = el("span", "in");
        if (row.refused) {
          into.appendChild(el("span", "", "The session could not take it now. Try again in a moment."));
        } else {
          into.title = "Goes to the session that reviewed it";
          into.appendChild(el("i", "dot"));
          into.appendChild(el("span", "", "Review #" + row.number + " in " + bare(row.repo)));
        }
        node.appendChild(into);
        return node;
      }
      default: return cell("you", "person", "Waiting on you", "rv");
    }
  }

  function bare(repo) {
    var slash = repo.lastIndexOf("/", repo.lastIndexOf("/") - 1);
    return repo.slice(slash + 1);
  }

  function goTo(row, label, cls) {
    if (row.session === null) return el("span", "quiet", "In another project");
    return button(label, cls, function () { if (bridge) bridge.show(row.session); });
  }

  function actsOf(row) {
    var acts = el("div", "acts");
    var key = row.key;
    switch (row.standing) {
      case "requested":
      case "again-new":
        acts.appendChild(button("Start review", "offer", function () { send({ do: "start", key: key }); }));
        break;
      case "again":
        acts.appendChild(button("Re-review", "offer", function () { send({ do: "again", key: key }); }));
        break;
      case "reviewing":
        acts.appendChild(goTo(row, "Go to session", ""));
        break;
      case "ready":
        acts.appendChild(goTo(row, "Read review", "offer"));
        break;
      default: {
        var nop = el("span", "quiet nop", "Not a project here");
        nop.tabIndex = 0;
        nop.appendChild(el("span", "tip", "No project here has " + row.repo + " as its repository. Add its folder as a project to review it here."));
        acts.appendChild(nop);
        acts.appendChild(button("Open on GitHub", "", function () { send({ do: "open", key: key }); }, "ext"));
      }
    }
    return acts;
  }

  function startOf(row, state, linked) {
    var node = el("div", "orow");
    node.dataset.key = row.key;
    var dot = el("span", "pdot");
    dot.dataset.state = state;
    node.appendChild(dot);

    var main = el("div");
    main.style.minWidth = "0";
    var title = el("div", "ttl", row.title);
    if (row.draft) title.appendChild(el("em", "", "Draft"));
    if (linked) {
      title.dataset.open = "";
      title.title = "Open on GitHub";
      title.tabIndex = 0;
      title.setAttribute("role", "link");
      var open = function () { send({ do: "open", key: row.key }); };
      title.addEventListener("click", open);
      title.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      });
    }
    main.appendChild(title);
    node.appendChild(main);
    return { node: node, main: main };
  }

  function myReviewOf(row) {
    var who = row.review.who.join(", ");
    var by = who ? " by " + who : "";
    switch (row.review.kind) {
      case "approved": return cell("ready", "tick", "Approved" + by, "rv");
      case "changes": return cell("fail", "x", "Changes requested" + by, "rv");
      case "asked": return cell("", "person", "Waiting on " + (who || "review"), "rv");
      default: return cell("", "dash", "No reviewers", "rv");
    }
  }

  function mineRowOf(row) {
    var parts = startOf(row, row.state, true);
    parts.main.appendChild(el("div", "sub", "#" + row.number + " · " + row.head + " · " + row.summary));
    parts.node.appendChild(checksOf(row));
    parts.node.appendChild(myReviewOf(row));
    var acts = el("div", "acts");
    acts.appendChild(button("Open on GitHub", "", function () { send({ do: "open", key: row.key }); }, "ext"));
    parts.node.appendChild(acts);
    return parts.node;
  }

  function emptyOf(icon, text) {
    var empty = el("div", "empty");
    empty.appendChild(svg(icon));
    empty.appendChild(el("span", "", text));
    return empty;
  }

  function scoped() { return typeof shown.repo === "string"; }

  function drawMine() {
    scopeEl.hidden = !scoped();
    mineEl.hidden = !scoped();
    mineRows.replaceChildren();
    if (!scoped()) return;
    scopeText.textContent = shown.repo ? "Showing " + shown.repo : "Showing this project's repository";
    var mine = Array.isArray(shown.mine) ? shown.mine : null;
    mineCount.textContent = mine ? String(mine.length) : "";
    if (mine === null) mineRows.appendChild(emptyOf("run", "Not read yet."));
    else if (mine.length === 0) mineRows.appendChild(emptyOf("tick", "You have no open pull requests here."));
    else mine.forEach(function (row) { mineRows.appendChild(mineRowOf(row)); });
  }

  function rowOf(row) {
    var parts = startOf(row, dotOf(row), row.standing !== "none");
    var node = parts.node;
    var main = parts.main;
    var sub = el("div", "sub");
    var slash = row.repo.lastIndexOf("/", row.repo.lastIndexOf("/") - 1);
    if (slash > 0) sub.appendChild(el("span", "host", row.repo.slice(0, slash + 1)));
    sub.appendChild(document.createTextNode(row.repo.slice(slash + 1) + " #" + row.number + " · by " + row.author + " · " + ago(row.at) + " · " + (row.draft ? "Draft" : "Ready")));
    main.appendChild(sub);

    node.appendChild(checksOf(row));
    node.appendChild(reviewOf(row));
    node.appendChild(actsOf(row));
    return node;
  }

  function draw() {
    if (shown === null) return;
    updatedEl.textContent = updated(shown.updated);
    troubleEl.hidden = !shown.trouble;
    troubleText.textContent = shown.trouble || "";
    var rows = Array.isArray(shown.rows) ? shown.rows : [];
    countEl.textContent = String(rows.length);
    rowsEl.replaceChildren();
    if (rows.length === 0) rowsEl.appendChild(emptyOf("tick", scoped() ? "No reviews asked of you here." : "No reviews asked of you."));
    drawMine();
    rows.forEach(function (row) { rowsEl.appendChild(rowOf(row)); });
    aim();
  }

  function aim() {
    if (target === null || shown === null) return;
    var key = target.indexOf("pr/") === 0 ? target.slice(3) : null;
    var found = null;
    rowsEl.querySelectorAll(".orow").forEach(function (node) {
      if (node.dataset.key === key) found = node;
    });
    // An overview leaves out other repositories, so a pull request it does
    // not show is looked for among them all.
    if (found === null && scoped()) {
      send({ do: "all" });
      return;
    }
    target = null;
    var at = found || document.getElementById("asks");
    at.scrollIntoView({ block: "center" });
    if (found) {
      found.classList.add("hl");
      setTimeout(function () { found.classList.remove("hl"); }, 1600);
    }
  }

  function scheme(context) {
    if (context && (context.scheme === "light" || context.scheme === "dark")) {
      document.documentElement.dataset.scheme = context.scheme;
    }
  }

  document.getElementById("refresh").addEventListener("click", function () { send({ do: "refresh" }); });
  document.getElementById("again").addEventListener("click", function () { send({ do: "refresh" }); });
  document.getElementById("all").addEventListener("click", function () { send({ do: "all" }); });
  setInterval(function () { if (shown !== null) updatedEl.textContent = updated(shown.updated); }, 30000);

  if (bridge) {
    bridge.onContext(scheme);
    bridge.onTarget(function (value) { if (typeof value === "string") { target = value; aim(); } });
    bridge.onData(function (data) {
      if (data && typeof data === "object" && Array.isArray(data.rows)) { shown = data; draw(); }
    });
  }
  send({ do: "ready" });
})();
`;
