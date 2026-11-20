/**
 * Every gh this plugin runs, and the only thing it runs at all besides
 * reading a folder's remotes. The arguments are a list, never a line for a
 * shell. gh never prompts, prints no colour and asks after no update, and
 * a call meant for one host names it, so github.com and an enterprise host
 * work side by side under whatever gh is signed in to.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

/** What a call said and how it ended. */
export interface Run {
  stdout: string;
  stderr: string;
  code: number;
}

/** Where a call runs, and the host it is for when the call does not name
    one itself. */
export interface Where {
  cwd?: string;
  host?: string;
}

/** Runs gh. Tests hand the plugin one of their own; gh itself is never
    called from a test. */
export type Gh = (args: string[], where?: Where) => Promise<Run>;

/** What stands in the way of reading a host. */
export type Trouble =
  | { kind: "missing" }
  | { kind: "signed-out"; host: string }
  | { kind: "limited"; host: string; until: number | null }
  | { kind: "failed"; host: string; text: string };

/** gh could not be started at all. */
export class Missing extends Error {
  constructor() {
    super("gh is not on the PATH");
    this.name = "Missing";
  }
}

/** How much a call may write before it is cut off. */
const MAX = 16 * 1024 * 1024;

/** How long one call may take. */
const TIMEOUT_MS = 60_000;

/** How much of what gh said goes on one line of the app's. */
const SAID = 300;

/** Runs gh with the arguments and answers with what it wrote and how it
    ended. A folder that is gone ends the call before gh starts. Only being
    unable to start gh throws, as Missing when it is not there. */
export const gh: Gh = (args, where = {}) =>
  new Promise((resolve, reject) => {
    if (where.cwd !== undefined && !existsSync(where.cwd)) {
      resolve({ stdout: "", stderr: `no such folder: ${where.cwd}`, code: 1 });
      return;
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      NO_COLOR: "1",
      CLICOLOR: "0",
    };
    if (where.host !== undefined) env.GH_HOST = where.host;
    const child = execFile(
      "gh",
      args,
      {
        cwd: where.cwd,
        env,
        maxBuffer: MAX,
        timeout: TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, code: 0 });
          return;
        }
        const code = (error as { code?: unknown }).code;
        if (code === "ENOENT") {
          reject(new Missing());
          return;
        }
        if (typeof code !== "number") {
          reject(new Error(`could not run gh: ${error.message}`));
          return;
        }
        resolve({ stdout, stderr, code });
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end();
  });

/** What gh said went wrong, as one line for the app to show. */
export function said(run: Run): string {
  const text = (run.stderr.trim() === "" ? run.stdout : run.stderr)
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replace(/^gh: /, "");
  if (text === "") return "gh failed and said nothing";
  return text.length > SAID ? `${text.slice(0, SAID).trimEnd()}...` : text;
}

const SIGNED_OUT =
  /gh auth login|not logged in|authentication required|HTTP 401|bad credentials|requires authentication|no oauth token/i;

const LIMITED = /rate limit|secondary rate|abuse detection/i;

/** What stands in the way, read from a call that failed for a host, or
    null when the call did not fail. */
export function troubleOf(run: Run, host: string): Trouble | null {
  if (run.code === 0) return null;
  const text = `${run.stderr}\n${run.stdout}`;
  // gh ends with 4 when it has no sign-in for the host at all.
  if (run.code === 4 || SIGNED_OUT.test(text)) {
    return { kind: "signed-out", host };
  }
  if (LIMITED.test(text)) return { kind: "limited", host, until: null };
  return { kind: "failed", host, text: said(run) };
}
