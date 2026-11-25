# github

The pull requests a session made, on GitHub or GitHub Enterprise, with
their checks and reviews: one fold under the session, a mark on its row,
and a line on that row when something about them changes. It reads
everything through `gh`, signed in as you are.

## The fold

**Pull requests** has a row per pull request the session owns: its number
and title, then the branch and a few words on how it stands. The
repository's name leads the line when the rows span more than one. A row's state is the
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

When nothing is owned there is no fold. The line beside the title is
empty unless something stands in the way of the session's pull requests;
then it says what and how to fix it, and the header says Try again: `gh`
not on the PATH, a host `gh` is not signed in to, with the `gh auth login
--hostname` line to run, a rate limit on a host and the time of day it
lifts, a repository GitHub cannot find, or, in a few words, what `gh` said
when a call failed.

## What it needs

`gh` on the PATH the plugin runs with, signed in. The plugin checks when it
is turned on and when the app starts, with one `gh auth status`, and again
on Check again. When `gh` is there and signed in nothing is said. When it
is not, the project's own Pull requests fold says so, beside its title and
in its rows, until a check finds it:

- **GitHub CLI, not found**: the install command for the machine
  (`brew install gh` on macOS, `winget install --id GitHub.cli` on Windows,
  a pointer to the guide elsewhere), an Install guide action that opens
  cli.github.com, and a row for the sign-in that waits on it.
- **Signed in to GitHub, not signed in**: run `gh auth login`.

The fold is the project's, so a session's own Pull requests fold takes its
place once there is one. Nothing is shown as a fault of the app, and the
rest of the plugin works as before: its reads still say what stands in the
way on the session's fold. A check that gets no answer from `gh` within ten
seconds, or an answer it does not know, says nothing.

## Whose pull requests

A pull request is a session's when the session ran `gh pr create`, it
succeeded, and it printed the address. When the output is held back,
because the command shared a line with others that print, the plugin asks
`gh pr view` in the command's folder for the branch it pushed, and claims
what it finds only when that was made in the last ten minutes and no other
session has it. A `gh pr create` that failed, or that found the pull
request already there, claims nothing. `gh pr merge`, `gh pr close` and
`gh pr ready` never claim; they only make the plugin read again.

A session in a worktree the app made for it also owns the pull request
whose head is its branch, unless another session claimed it. A folder alone
is never enough, so sessions sharing a checkout do not see each other's.

A pull request shows only in the session that owns it. A session that
started others does not show theirs.

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
first time it is seen. Your own reviews are not told. Only the session that
owns the pull request is told, and once that session has ended nobody is.
There are no settings, so every kind is on.

## Reviews asked of you

The open pull requests whose authors asked you by name for a review, on
every host an open project's repository is on, at most 30 a host. A team
asked on your behalf does not count. A review asked since the last look is
told once as the plugin's own notification, one by itself and several in
one line; clicking it opens the page at that pull request. The asks the
plugin finds when it starts are not told.

A session's fold has a row, "N reviews asked of you", whose View opens the
page, while the session's project is a repository on a host searched. A
review session has a row for the pull request it reviews, and the line
beside the title says reviewing.

The page lists each review asked: its title, repository, author and age,
its checks, and where it stands. An ask's age is the pull request's, from
when it was opened, since GitHub does not say when the review was asked;
the page sorts by it too. While a start or a line for a pull request waits
on the app's answer, at most half a minute, another click on it does
nothing.

- **Review requested.** Start review asks, on the app's card, to start a
  Reviewer session named `Review #42 in orbit/api` in a worktree of the
  project the pull request's repository is open as: the page's own project
  when it is that repository, otherwise the first project that is. It is
  told to check the pull request out with `gh pr checkout --repo`, read the
  change, run the tests that apply, and post nothing to GitHub. When the
  pull request comes from a fork, it is told to read the change and run
  nothing from it, its tests included.
- **Reviewing**, while that session runs. Go to session brings it on
  screen.
- **Review ready to read**, once it ended or was put away. Read review
  brings it on screen.
- **Re-review requested**, when you reviewed and were asked again.
  Re-review sends the session that reviewed a line to look again. When
  that session will not come back, the app's card offers a new one
  instead. When the session cannot take the line, such as a terminal busy
  with a command, the row says so and Re-review can be clicked again.
- **Not a project here**, when no open project has the repository. Open
  on GitHub is all there is.

A prompt names the pull request only by repository, number and address,
never by its title, author or anything else someone wrote, and tells the
session to take the pull request's text as its author's words. Every `gh`
command in it names the repository, so the checkout's remotes never pick
another one. The page
draws titles and names as text. Clicking a title opens the pull request
on GitHub.

The page follows the app's theme. Which session reviewed which pull
request is kept in `reviews.json` beside the claims, for a month or 200
pull requests.

## Pull request overview

**Pull request overview** in the app's command palette opens the page for
the project, showing its repository alone: your open pull requests there,
the newest 30, then the reviews asked of you there. Each of yours has its
title, branch, checks, reviewers and a few words on how it stands, and
opens on GitHub. The reviews asked are those the search above found for the
host. The command is offered where the project's repository is on a host
`gh` is signed in to.

Show all repositories, a View row in a fold, and a notification for a pull
request the overview leaves out bring back every repository.

## When it reads

Once a minute while any pull request it shows is open, half as long again
each time nothing changed, up to five minutes, and not at all when none is.
At once after one of the commands above, on Refresh, and when a session
starts. Every repository is one GraphQL call per read, however many pull
requests it holds. A host that is rate limited, or has fewer than a hundred
calls left, is left alone until GitHub says its limit lifts, at most half
an hour, while the other hosts go on being read. The folds with pull
requests on that host say so while it waits.

The reviews asked of you are searched on a timer of their own, one GraphQL
call per searched host: once a minute, half as long again each time
nothing changed, up to five minutes, and not at all while no open project
is a repository on github.com or a host `gh` is signed in to. At once when a project
opens and on the page's Refresh. A rate limit is the host's, so a host
paused for one waits for both, and Refresh or Try again on the page lifts
the pause for both.

Your own pull requests are searched with the reviews asked, one more
GraphQL call per repository whose overview is open, until its page shows
all repositories again or the project closes.

## Hosts

Whatever `gh` is signed in to. A pull request's host is the one in its
address, and a branch's is the one in the checkout's remote, given to `gh`
as `--hostname` or `GH_HOST`. A branch is only looked up on a host `gh auth
status` lists, so a remote on a host you never signed in to costs nothing.
What `gh auth status` said holds for ten minutes, so signing in to a host
is noticed within that, or at once on Refresh. While a worktree's remote is
on a host `gh` is not signed in to, it is asked again every ten minutes, at
most three times, and then not until Refresh.

A repository that fails to read shows the failure only on the sessions with
pull requests in it. GitHub gives the same answer for a repository that was
deleted and one the account `gh` uses cannot see, so one it cannot find
keeps its claims: the sessions with pull requests in it say so, and it is
not read again until Try again, Refresh or a restart, or until a session
makes a pull request in it. Its claims go with the session, as all do.

## What it runs

`gh` and `git config --get-regexp ^remote\.` in a session's folder, and
nothing else (the check for `gh` runs where the plugin runs), each as an argument list rather than a line for a shell. A
call that has not answered within a minute is ended. It has no tools for
the agent.

## Not covered

- A remote through an SSH alias of your own, such as `git@work:orbit/api`,
  names a host GitHub does not know, so a worktree session on it gets no
  pull request by its branch. Claims from `gh pr create` work as usual.
- Only the first 100 checks of a pull request are read. When there are
  more, GitHub's overall state for all of them stands in for the rest, as
  one more check that failed or is running, so a failure past the first 100
  still shows, without its name.

## Where the claims are

`~/.agent-workbench/plugins/github/sessions.json`, the pull requests each
session owns, keyed by the agent's session id, so they outlast the plugin
and the app. A pull request merged or closed three days ago goes, so does a
session not seen for a month, and past 200 sessions or 50 pull requests a
session the oldest go first. `WORKBENCH_GITHUB_HOME` puts that directory
under a home of its own, which is what the tests use.
