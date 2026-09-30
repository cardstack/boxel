# Working with parallel Claude sessions

Several Claude Code sessions routinely run against this repo at once, each in
its own worktree. They can talk to each other directly: `ListAgents` names the
sessions an agent can reach, and `SendMessage` addresses one by name. That
costs nothing to set up for sessions on the same machine.

Reaching the sessions running on your _other_ machines — and in the cloud —
takes one setting per machine. This page is that setup. What the agents then do
with the channel is the `agent-peer-collaboration` skill's subject, and agent
sessions load it on their own.

## Why bother

Sessions on one machine contend over local resources: the ports, the Docker
containers, the single test stack, the realm-server test lane. Sessions on
different machines share none of that. What they do share is the repo, the pull
requests, and your account, which is enough for real collisions and real
corroboration:

- **Duplicate debugging.** A cause that arrives through `main`, a dependency
  bump, or a broken tool hits every checkout at once. Two sessions on two
  machines will independently debug it unless one of them asks.
- **The GitHub API budget** is per user. `gh pr view` and `gh pr checks` draw
  on one bucket shared by every session on the account; when it empties, every
  GraphQL-based monitor goes silently blind, on all your machines.
- **Competing pull requests.** Two sessions can open two PRs for one fix as
  easily as two worktrees can.
- **Environmental evidence.** A failure that reproduces on another machine
  shares no stack, no containers, and no host build with yours, so it rules out
  local state in a way a same-machine repro cannot. One that reproduces on only
  one machine names that machine as the suspect.

## Turn it on

Remote Control is what makes a session reachable from outside its own machine.
Three ways in, from most to least persistent:

| Scope              | How                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Every session      | `"remoteControlAtStartup": true` in your user settings, or the `/config` toggle for all sessions        |
| One live session   | `/remote-control`                                                                                       |
| A dedicated server | `claude remote-control` in the directory you want to work in (`--spawn=worktree` isolates each session) |

Prerequisites: be logged in with an account that carries a subscription, and
run `claude` once in the directory so the workspace trust prompt is out of the
way. Organization policy can disable Remote Control outright, in which case the
command says so rather than failing quietly.

**Keep the setting in your user settings, not in the repo's.** It makes every
session in a directory reachable from claude.ai and the Claude mobile app,
which is a decision each person makes for their own machines. A checked-in
value would also apply to CI checkouts and to throwaway agent worktrees, which
have no use for it.

## Give each machine its own session-name prefix

A session's name is its address. Names are generated per session from the
project, so every session in this repo — on every machine — reads as a
variation on the same stem, and a listing of a dozen of them tells you nothing
about where any of them is running. Two that coincide outright have to be
disambiguated by hand on every send. Prefix each machine's sessions instead:

```json
{ "remoteControlSessionNamePrefix": "<short-machine-label>" }
```

The environment variable `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX` and the
`--remote-control-session-name-prefix` flag do the same thing. Keep the label
short — it is a prefix on every session name you will read in a listing.

## Decide what you accept, and what you reach

`crossSessionInbound` governs messages arriving from your other sessions:
`accept` delivers them, `hold` parks each one for your review without letting
Claude act on it, and `refuse` opts the session out. An explicit value always
wins, and a repository that tightens this beats a personal `accept`.

Left unset, delivery follows permission-mode parity: a message auto-delivers
only when the sending session's mode class matches yours — bypass to bypass,
or prompting to prompting. A mismatched sender is held for your approval, and
a sender that asserts no class at all is held only while your session bypasses
permission prompts. So a permissive session and a default-mode session do not
exchange messages freely. A held message waits as long as `dialogExpiry`
allows — five minutes by default, `never` to remove the deadline — and is then
dropped, which is how a message goes unread while waiting for an approval
nobody was watching for.

**For collaboration, set `accept`.** The protocols agents follow are
time-sensitive — an announcement before a shared resource is taken, a handoff
when it is released — and a held message is not a late message: it is dropped
once the deadline passes, and nothing tells the sender. `accept` is what makes
the channel usable when nobody is watching it.

Leaving it unset is cautious rather than wrong, and on a fleet where every
session runs the same permission mode it behaves the same as `accept`. Where
it bites is cross-machine. The mode attestation rides the local peer socket,
so a peer reached over Remote Control or in the cloud asserts no mode class at
all, and its message into a session that bypasses permission prompts is held
for approval — the `no-mode-asserted` hold. No receipt reaches a remote sender
either, so once the hold expires its message is simply gone and your session
reads as merely busy. Unset therefore means cross-machine coordination works
only while someone is present to approve it.

`refuse` takes a session out of the protocol. It can still send, but no peer's
announcement reaches it, so it cannot take part in any coordination that
depends on being told — and peers have no way to learn that. Use it for a
session you want left alone, not for one you expect to collaborate.

Accepting delivery is not granting authority. A peer's message is a
teammate's input, not your consent: the receiving session's own permission
rules still govern everything it does with that input, and no session may ask
a peer to do what its own permissions refused.

`isolatePeerMachines` covers the other direction: it requires explicit
approval before one of your sessions can reach a peer on another machine at
all. Reachability and unattended traffic are separate decisions — turn Remote
Control on so the coordination is possible, and set this if you want each
cross-machine send to pass through you first.

## What to expect once it is on

- `ListAgents` labels each row by kind — subagents, sessions on this machine,
  sessions on other machines, cloud sessions.
- A session without Remote Control is invisible there. The listing is a floor
  on who is live, never a roster, so an absence proves nothing about another
  machine.
- A peer on the same machine reports back when it refuses or holds a message. A
  peer on another machine reports nothing at all, so silence from one carries no
  information in either direction — it is not consent.
- `notify_when_idle` subscribes only to a session on the same machine.
