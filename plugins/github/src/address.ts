/**
 * Where a pull request lives, read from what a person or gh writes: its
 * web address, a remote's URL, `owner/repo#42`, and the words of a
 * `gh pr` command.
 */

/** A repository on a host. */
export interface Repo {
  host: string;
  owner: string;
  name: string;
}

/** A pull request in a repository. */
export interface PullRef extends Repo {
  number: number;
}

/** A repository's key, the same whatever the case it was written in. */
export function repoKey(repo: Repo): string {
  return `${repo.host}/${repo.owner}/${repo.name}`.toLowerCase();
}

/** A pull request's key, the same whatever the case it was written in. */
export function pullKey(ref: PullRef): string {
  return `${repoKey(ref)}#${ref.number}`;
}

/** The repository and number a pull request's key names, or null for a
    key that is not one. */
export function refOfKey(key: string): PullRef | null {
  const found = /^([^/\s]+)\/([^/\s]+)\/([^/#\s]+)#(\d+)$/.exec(key);
  if (found === null) return null;
  const [, host, owner, name, number] = found;
  if (!host || !owner || !name || !number) return null;
  return { host, owner, name, number: Number(number) };
}

const PULL_URL =
  /https?:\/\/([A-Za-z0-9.-]+(?::\d+)?)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g;

/** Every pull request a text names by its web address, in order. */
export function pullUrls(text: string): PullRef[] {
  const found: PullRef[] = [];
  for (const match of text.matchAll(PULL_URL)) {
    const [, host, owner, name, number] = match;
    if (!host || !owner || !name || !number) continue;
    found.push({ host: host.toLowerCase(), owner, name, number: +number });
  }
  return found;
}

/** The pull request a web address names, when that is all it is. */
export function pullOfUrl(text: string): PullRef | null {
  const found = pullUrls(text);
  return found.length === 1 && text.trim().startsWith("http")
    ? (found[0] ?? null)
    : null;
}

/** The web address of a pull request. */
export function urlOf(ref: PullRef): string {
  return `https://${ref.host}/${ref.owner}/${ref.name}/pull/${ref.number}`;
}

/** The repository a remote's URL points at, or null for one that is not
    on a host gh can talk to. */
export function repoOfRemote(url: string): Repo | null {
  const text = url.trim();
  let host: string;
  let path: string;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(text);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    let parsed: URL;
    try {
      parsed = new URL(text);
    } catch {
      return null;
    }
    if (!/^(https?|ssh|git):$/.test(parsed.protocol)) return null;
    host = parsed.hostname;
    path = parsed.pathname;
  } else if (scp !== null && scp[1] !== undefined && scp[2] !== undefined) {
    host = scp[1];
    path = scp[2];
  } else {
    return null;
  }
  const parts = path
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/, "")
    .split("/");
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (!owner || !name) return null;
  host = host.toLowerCase();
  // GitHub's SSH over port 443 is the same host.
  if (host === "ssh.github.com") host = "github.com";
  return { host, owner, name };
}

/** What a `gh pr` command does to a pull request. */
export type Verb = "create" | "merge" | "close" | "ready";

/** What a heard command said: its verb, the pull request it named, the
    repository it named with -R, and the head it named with --head. */
export interface Words {
  verb: Verb;
  /** A number, a web address or a branch, as written. */
  target: string | null;
  /** The repository given with -R or --repo, as written. */
  repo: string | null;
  /** The branch given to `gh pr create` with -H or --head. */
  head: string | null;
}

/** The options of each verb that take a value, short and long. */
const VALUED: Record<Verb, Set<string>> = {
  create: new Set([
    "-a",
    "--assignee",
    "-B",
    "--base",
    "-b",
    "--body",
    "-F",
    "--body-file",
    "-H",
    "--head",
    "-l",
    "--label",
    "-m",
    "--milestone",
    "-p",
    "--project",
    "--recover",
    "-r",
    "--reviewer",
    "-T",
    "--template",
    "-t",
    "--title",
    "-R",
    "--repo",
  ]),
  merge: new Set([
    "-A",
    "--author-email",
    "-b",
    "--body",
    "-F",
    "--body-file",
    "--match-head-commit",
    "-t",
    "--subject",
    "-R",
    "--repo",
  ]),
  close: new Set(["-c", "--comment", "-R", "--repo"]),
  ready: new Set(["-R", "--repo"]),
};

const OPERATORS = new Set(["&&", "||", ";", "|", "&", "\n", "(", ")"]);

/**
 * A command line cut into words the way a shell would, near enough to
 * read a `gh pr` command from: quotes are taken off, a backslash keeps the
 * next character, and the operators that end a command stand as words of
 * their own. A quote left open runs to the end.
 */
export function shellWords(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  const end = (): void => {
    if (started) words.push(word);
    word = "";
    started = false;
  };
  for (let at = 0; at < line.length; at++) {
    const char = line[at] as string;
    if (char === "'") {
      started = true;
      const close = line.indexOf("'", at + 1);
      const stop = close === -1 ? line.length : close;
      word += line.slice(at + 1, stop);
      at = stop;
    } else if (char === '"') {
      started = true;
      at++;
      while (at < line.length && line[at] !== '"') {
        if (line[at] === "\\" && at + 1 < line.length) at++;
        word += line[at];
        at++;
      }
    } else if (char === "\\" && at + 1 < line.length) {
      started = true;
      at++;
      if (line[at] !== "\n") word += line[at];
    } else if (char === "\n" || /[;&|()]/.test(char)) {
      end();
      const two = line.slice(at, at + 2);
      if (two === "&&" || two === "||") {
        words.push(two);
        at++;
      } else {
        words.push(char);
      }
    } else if (/\s/.test(char)) {
      end();
    } else {
      started = true;
      word += char;
    }
  }
  end();
  return words;
}

/**
 * What a heard command does, or null when it holds no `gh pr` verb this
 * plugin hears. gh counts only where a command starts, after any
 * `NAME=value` it is given, and a command handed to a shell with `-c`
 * is read inside it.
 */
export function wordsOf(command: string): Words | null {
  return read(shellWords(command), 0);
}

function read(words: string[], depth: number): Words | null {
  let start = true;
  for (let at = 0; at < words.length; at++) {
    const word = words[at] as string;
    if (OPERATORS.has(word)) {
      start = true;
      continue;
    }
    if (depth < 3 && /^-[a-z]*c$/.test(words[at - 1] ?? "")) {
      const inner = read(shellWords(word), depth + 1);
      if (inner !== null) return inner;
    }
    if (start && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    const first = start;
    start = false;
    if (!first || !/(^|\/)gh$/.test(word) || words[at + 1] !== "pr") continue;
    const verb = words[at + 2];
    if (
      verb !== "create" &&
      verb !== "merge" &&
      verb !== "close" &&
      verb !== "ready"
    ) {
      continue;
    }
    return args(verb, words.slice(at + 3));
  }
  return null;
}

/**
 * The words after a verb, read the way gh reads its flags: `--name value`
 * or `--name=value`, and short flags that may stand together, the last
 * one taking its value from the rest of the word (`-Hfix`, `-H=fix`,
 * `-dHfix`) or from the next word.
 */
function args(verb: Verb, rest: string[]): Words {
  const found: Words = { verb, target: null, repo: null, head: null };
  const valued = VALUED[verb];
  const take = (name: string, value: string): void => {
    if (value === "") return;
    if (name === "-R" || name === "--repo") found.repo = value;
    if (verb === "create" && (name === "-H" || name === "--head")) {
      found.head = value;
    }
  };
  for (let at = 0; at < rest.length; at++) {
    const word = rest[at] as string;
    if (OPERATORS.has(word)) break;
    if (word === "--") {
      const next = rest[at + 1];
      if (found.target === null && next !== undefined && !OPERATORS.has(next))
        found.target = next;
      break;
    }
    if (word.startsWith("--")) {
      const equals = word.indexOf("=");
      if (equals !== -1) {
        take(word.slice(0, equals), word.slice(equals + 1));
      } else if (valued.has(word)) {
        const value = rest[at + 1];
        at++;
        if (value !== undefined) take(word, value);
      }
      continue;
    }
    if (word.startsWith("-") && word !== "-") {
      for (let char = 1; char < word.length; char++) {
        const name = `-${word[char]}`;
        if (!valued.has(name)) continue;
        let value = word.slice(char + 1);
        if (value.startsWith("=")) value = value.slice(1);
        if (value === "" && char + 1 === word.length) {
          const next = rest[at + 1];
          at++;
          if (next !== undefined) take(name, next);
        } else {
          take(name, value);
        }
        break;
      }
      continue;
    }
    if (verb !== "create" && found.target === null) found.target = word;
  }
  return found;
}
