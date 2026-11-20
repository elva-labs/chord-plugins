# github

The pull requests a session made, on GitHub or GitHub Enterprise, with
their checks and reviews: one fold under the session, a mark on its row,
and a line on that row when something about them changes. It reads
everything through `gh`, signed in as you are.

## The fold

**Pull requests** has a row per pull request the session owns: its number
and title, then the branch, a few words on how it stands, and, for a
session this one started, which session it came from. The repository's
name leads the line when the rows span more than one. A row's state is the
worst of its checks and its reviews: failed for a failing check or changes
requested, busy while checks run, waiting on a review, ok when all is well.
Its facts say the same at length: which checks failed and how many passed,
who requested changes, approved or was asked to review, whether it merges
without conflicts or is behind its base, whether it is a draft, and, once
it is done, that it was merged or closed.

Enter opens the pull request on GitHub. Merge is on the row when GitHub
says it can go in as it is and you may merge it; it asks first, naming the
base and the repository's own way of merging, and merges with that, only
if the head is still the commit you saw. The header reads everything again
with Refresh.

When nothing is owned there is no fold. When something stands in the way
the line beside the title says what and how to fix it, and the header says
Try again: `gh` not on the PATH, a host `gh` is not signed in to, with the
`gh auth login --hostname` line to run, a rate limit and how long until it
lifts, or what `gh` said when a call failed.

## Whose pull requests

A pull request is a session's when the session ran `gh pr create` and it
answered with the address. When the output is held back, because the
command shared a line with others that print, the plugin asks
`gh pr view` in the command's folder for the branch it pushed. `gh pr
merge`, `gh pr close` and `gh pr ready` claim a pull request only when no
session has it yet.

A session in a worktree the app made for it also owns the pull request
whose head is its branch, unless another session claimed it. A folder alone
is never enough, so sessions sharing a checkout do not see each other's.

A session that started others shows their pull requests as well, each
marked with the session it came from, and keeps them after those sessions
end.

## The mark

The pull-request icon on the session's row, with how many of its pull
requests are open, tinted by the worst of their states. Hovering says how
many and why: a failing check, changes requested, waiting on review, checks
running, or all well. It goes when none is open.

## The lines on the row

A line on the session's row, for the pull requests the session owns, when
a check fails, when the checks pass after failing, when someone approves,
requests changes or comments in a review, and when one is merged or closed.
Each change is told once, and nothing is told about a pull request the
first time it is seen. Your own reviews are not told. A session that has
ended passes its lines to the session that started it, when that one is
still running. There are no settings, so every kind is on.

## When it reads

Once a minute while any pull request it shows is open, half as long again
each time nothing changed, up to five minutes, and not at all when none is.
At once after one of the commands above, on Refresh, and when a session
starts. Every repository is one GraphQL call per read, however many pull
requests it holds. A rate limit waits until GitHub says it lifts, at most
half an hour, and the fold says so meanwhile.

## Hosts

Whatever `gh` is signed in to. A pull request's host is the one in its
address, and a branch's is the one in the checkout's remote, given to `gh`
as `--hostname` or `GH_HOST`. A branch is only looked up on a host `gh auth
status` lists, so a remote on a host you never signed in to costs nothing.

## What it runs

`gh` and `git config --get-regexp ^remote\.` in a session's folder, and
nothing else, each as an argument list rather than a line for a shell. It
has no tools for the agent.

## Where the claims are

`~/.agent-workbench/plugins/github/sessions.json`, the pull requests each
session owns, keyed by the agent's session id, so they outlast the plugin
and the app. A pull request merged or closed three days ago goes, so does a
session not seen for a month, and past 200 sessions or 50 pull requests a
session the oldest go first. `WORKBENCH_GITHUB_HOME` puts that directory
under a home of its own, which is what the tests use.
