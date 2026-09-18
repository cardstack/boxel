# The realm mirror is shared mutable state

A local realm mirror is not your working copy. It is a directory that any
number of agents, sessions, and editor windows may be writing at once, and the
commands that keep it in step with the realm have no concurrency control.

**`npx boxel realm pull` overwrites every local file with the realm's copy. It
does not check whether a local file has changes that were never pushed, and it
does not warn.** Anything edited but not yet pushed is gone: no error, no
conflict marker, and nothing to recover from — the `.boxel-history` checkpoint
is written *after* the overwrite, so the pre-pull bytes were never committed.

Only `--delete`, `--force` and `remove` are labelled destructive. A plain
`pull` is the one that actually loses work.

## The rules

**1. Never `realm pull` into a directory anyone is editing.** That includes
another agent session, and it includes you five tool calls ago. `pull` is for
*provisioning a fresh mirror*, not for updating one that is in use.

**2. Generate outside the mirror; push from there.** The mirror is never your
storage. `file write` takes its source from anywhere:

```sh
# build output in a scratch dir, then land it
npx boxel file write <realm-path> --realm <realm-url> --file <scratch-path>
```

A pull cannot reach a scratch directory. This is the single practice that
makes bulk generation (migrations, imports, generated instances) safe.

**3. For `.gts`, edit → lint → push in one unbroken sequence.** The exposure
window is edit-to-push; once the file is on the realm, a pull brings your own
version back down. Do not leave an edited module sitting unpushed across other
work.

**4. Re-verify before trusting a file you edited earlier.** If several tool
calls have passed, `grep` for a marker you added before building on it. An edit
that silently reverted looks exactly like an edit that never applied, and the
two cost very different amounts to diagnose.

**5. Prefer `realm status --pull` over `realm pull` when the CLI has it.**
`status` is read-only by default and classifies every file as
`modified-local`, `modified-remote`, `new-remote` or `conflict`. Its `--pull`
downloads *only* `new-remote` and `modified-remote` — files with no local
changes — skipping conflicts by construction and updating the manifest for
what it took. That is the safe pull.

> Not every installed CLI has `status`. Check `npx boxel realm --help`; if it
> lists only `pull` / `push` / `sync`, rules 1–4 are all you have.

## Detecting that you are not alone

`.boxel-history` is a git repo of the mirror, and every pull and push writes a
checkpoint into it:

```sh
git -C <local-dir>/.boxel-history log --format='%ad %s' --date=format:'%H:%M' -10
```

A `[remote] Pull` you did not run means another session is working this mirror.
`git -C <local-dir>/.boxel-history show --stat HEAD` shows what it brought
down; files you never touched are that other session's work arriving.

## Why a hand-rolled dirty check is unreliable

`.boxel-sync.json` records an md5 per file, so comparing it against the working
tree looks like a way to find unpushed edits. It is — but **`pull` never
updates the manifest** (`push`, `sync`, `status` and `watch` do). After any
pull the baseline is stale, and everything downloaded since reads as an
untracked local file.

So a manifest comparison is only trustworthy for paths you know you touched.
Use it to confirm your own work is still there, not to decide whether a pull is
safe.

## Recovering

If a pull already took your work, the mirror's history is the only chance:

```sh
git -C <local-dir>/.boxel-history log --oneline -20
git -C <local-dir>/.boxel-history show <sha>:<realm-relative-path>
```

The pre-pull state is generally *not* checkpointed, so this often will not have
it. Re-doing the work from the realm's current state is frequently faster than
hunting — recognise the failure early rather than diagnosing it twice.
