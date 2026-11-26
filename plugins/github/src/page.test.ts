import { expect, it } from "vitest";
import type { PageData, PageRow } from "./offers.js";
import { page } from "./page.js";

/** An element as much as the page's script uses of one. */
class Element {
  children: Element[] = [];
  className = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  hidden = false;
  title = "";
  tabIndex = -1;
  type = "";
  #text = "";
  #listeners: Record<string, ((event?: unknown) => void)[]> = {};
  classList = {
    add: (name: string) => {
      this.className = `${this.className} ${name}`.trim();
    },
    remove: (name: string) => {
      this.className = this.className
        .split(" ")
        .filter((one) => one !== name)
        .join(" ");
    },
  };

  constructor(public tag: string) {}

  get textContent(): string {
    return this.#text + this.children.map((one) => one.textContent).join("");
  }

  set textContent(value: string) {
    this.#text = value;
    this.children = [];
  }

  appendChild(child: Element): Element {
    this.children.push(child);
    return child;
  }

  replaceChildren(): void {
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(kind: string, fn: (event?: unknown) => void): void {
    (this.#listeners[kind] ??= []).push(fn);
  }

  click(): void {
    for (const fn of this.#listeners.click ?? []) fn();
  }

  /** Presses a key on it, and says whether the page kept the key's own
      doing from happening. */
  press(key: string): boolean {
    let kept = false;
    const event = { key, preventDefault: () => (kept = true) };
    for (const fn of this.#listeners.keydown ?? []) fn(event);
    return kept;
  }

  scrollIntoView(): void {}

  querySelectorAll(selector: string): Element[] {
    const name = selector.replace(/^\./, "");
    return this.all().filter((one) => one.className.split(" ").includes(name));
  }

  all(): Element[] {
    return this.children.flatMap((one) => [one, ...one.all()]);
  }
}

/** Runs the page's script against a stand-in document and bridge. */
function load() {
  const html = page();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
  const byId = new Map<string, Element>();
  for (const id of [
    "rows",
    "count",
    "updated",
    "trouble",
    "trouble-text",
    "refresh",
    "again",
    "asks",
  ]) {
    byId.set(id, new Element("div"));
  }
  const root = { dataset: {} as Record<string, string> };
  const document = {
    documentElement: root,
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: (tag: string) => new Element(tag),
    createElementNS: (_: string, tag: string) => new Element(tag),
    createTextNode: (text: string) => {
      const node = new Element("#text");
      node.textContent = text;
      return node;
    },
  };
  const sent: unknown[] = [];
  const shown: string[] = [];
  const hooks: {
    data?: (data: unknown) => void;
    context?: (context: unknown) => void;
    target?: (target: string) => void;
  } = {};
  const bridge = {
    send: (payload: unknown) => sent.push(payload),
    show: (session: string) => shown.push(session),
    onData: (fn: (data: unknown) => void) => (hooks.data = fn),
    onContext: (fn: (context: unknown) => void) => (hooks.context = fn),
    onTarget: (fn: (target: string) => void) => (hooks.target = fn),
  };
  new Function("window", "document", "setInterval", "setTimeout", script)(
    { workbench: bridge },
    document,
    () => 0,
    () => 0,
  );
  const rows = byId.get("rows") as Element;
  const buttons = (label: string) =>
    rows
      .all()
      .filter((one) => one.tag === "button" && one.textContent === label);
  return { html, byId, root, sent, shown, hooks, rows, buttons };
}

function row(over: Partial<PageRow> = {}): PageRow {
  return {
    key: "github.com/orbit/api#7",
    title: "Retry the upload",
    url: "https://github.com/orbit/api/pull/7",
    repo: "orbit/api",
    number: 7,
    author: "Grace Hopper",
    at: Date.now() - 2 * 60 * 60 * 1000,
    draft: false,
    checks: { failed: 0, passed: 3, running: 0 },
    standing: "requested",
    session: null,
    refused: false,
    ...over,
  };
}

function data(rows: PageRow[], over: Partial<PageData> = {}): PageData {
  return { updated: Date.now(), trouble: null, rows, ...over };
}

it("writes nothing as markup from a script, and its script parses", () => {
  const html = page();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
  expect(() => new Function(script)).not.toThrow();
  expect(script).not.toMatch(
    /innerHTML|outerHTML|insertAdjacentHTML|eval\(|document\.write/,
  );
  expect(html).toContain('id="asks"');
  expect(html).toContain("var(--workbench-bg");
});

it("says it is ready, and asks again on Refresh and Try again", () => {
  const { sent, byId } = load();
  expect(sent).toEqual([{ do: "ready" }]);
  byId.get("refresh")?.click();
  byId.get("again")?.click();
  expect(sent.slice(1)).toEqual([{ do: "refresh" }, { do: "refresh" }]);
});

it("draws a title and a name as text, however they are written", () => {
  const { hooks, rows } = load();
  const title = '<img src=x onerror="alert(1)">';
  hooks.data?.(data([row({ title, author: "<b>Mallory</b>" })]));
  const ttl = rows.all().find((one) => one.className === "ttl");
  expect(ttl?.textContent).toBe(title);
  expect(rows.all().some((one) => one.tag === "img")).toBe(false);
  expect(rows.textContent).toContain("by <b>Mallory</b>");
});

it("offers what each standing allows, and sends only the pull request's key", () => {
  const { hooks, buttons, sent, shown, byId } = load();
  hooks.data?.(
    data([
      row({ key: "a", standing: "requested" }),
      row({ key: "b", standing: "again" }),
      row({ key: "c", standing: "again-new" }),
      row({ key: "d", standing: "reviewing", session: "s1" }),
      row({ key: "e", standing: "ready", session: "s2" }),
      row({ key: "f", standing: "ready", session: null }),
      row({ key: "g", standing: "none" }),
    ]),
  );
  expect(byId.get("count")?.textContent).toBe("7");
  buttons("Start review").forEach((one) => one.click());
  buttons("Re-review")[0]?.click();
  buttons("Go to session")[0]?.click();
  buttons("Read review")[0]?.click();
  buttons("Open on GitHub")[0]?.click();
  expect(sent.slice(1)).toEqual([
    { do: "start", key: "a" },
    { do: "start", key: "c" },
    { do: "again", key: "b" },
    { do: "open", key: "g" },
  ]);
  expect(shown).toEqual(["s1", "s2"]);
  expect(buttons("Read review")).toHaveLength(1);
  const rows = byId.get("rows") as Element;
  expect(rows.textContent).toContain("In another project");
  expect(rows.textContent).toContain("Not a project here");
});

it("says what is in the way, follows the scheme, and takes only data with rows", () => {
  const { hooks, byId, root } = load();
  hooks.data?.(data([], { trouble: "gh is not signed in to github.com" }));
  expect(byId.get("trouble")?.hidden).toBe(false);
  expect(byId.get("trouble-text")?.textContent).toBe(
    "gh is not signed in to github.com",
  );
  expect(byId.get("rows")?.textContent).toContain("No reviews asked of you.");
  hooks.data?.({ rows: "no" });
  expect(byId.get("trouble-text")?.textContent).toBe(
    "gh is not signed in to github.com",
  );
  hooks.context?.({ scheme: "light" });
  expect(root.dataset.scheme).toBe("light");
  hooks.context?.({ scheme: "<x>" });
  expect(root.dataset.scheme).toBe("light");
});

it("opens a title as a link, on Enter and on Space", () => {
  const { hooks, rows, sent } = load();
  hooks.data?.(data([row({ key: "a" }), row({ key: "g", standing: "none" })]));
  const [ttl, plainTtl] = rows.all().filter((one) => one.className === "ttl");
  expect(ttl?.attributes.role).toBe("link");
  expect(ttl?.tabIndex).toBe(0);
  expect(plainTtl?.attributes.role).toBeUndefined();
  expect(ttl?.press("Enter")).toBe(true);
  expect(ttl?.press(" ")).toBe(true);
  expect(ttl?.press("a")).toBe(false);
  expect(sent.slice(1)).toEqual([
    { do: "open", key: "a" },
    { do: "open", key: "a" },
  ]);
});

it("names the session a review asked again goes to, or says it could not take the line", () => {
  const { hooks, rows, buttons } = load();
  hooks.data?.(
    data([row({ standing: "again", repo: "ghe.corp.example/orbit/api" })]),
  );
  expect(rows.textContent).toContain("Review #7 in orbit/api");
  expect(rows.textContent).not.toContain("Retry the upload: ");
  hooks.data?.(data([row({ standing: "again", refused: true })]));
  expect(rows.textContent).toContain(
    "The session could not take it now. Try again in a moment.",
  );
  expect(buttons("Re-review")[0]?.className).not.toContain("pressed");
});

it("lights the pull request a notification named", () => {
  const { hooks, rows } = load();
  hooks.data?.(data([row({ key: "a" }), row({ key: "b" })]));
  hooks.target?.("pr/b");
  const lit = rows.querySelectorAll(".hl");
  expect(lit.map((one) => one.dataset.key)).toEqual(["b"]);
});
