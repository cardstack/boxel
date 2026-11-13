---
status: proposed
date: 2026-11-12
scope:
  - packages/realm-historian/**
  - packages/runtime-common/realm-history.ts
  - packages/realm-server/lib/realm-registry-backfill.ts
  - packages/realm-server/lib/realm-registry-writes.ts
  - packages/postgres/migrations/*realm-registry*
---

# 034. Keep each realm's history in a SHA-256 git repo named by its permanent registry id

realm-historian records each realm's revision history in a git repo, and the
realm server reads it back (ADR 018). This ADR fixes the format of those
repos. Each realm gets one bare SHA-256 repo with a linear `refs/heads/main`,
named by the realm's `realm_registry.id`. The git author is the writer's
Matrix user ID, the metadata is in `Boxel-*` trailers, and a file whose
content isn't kept has a tree layout of its own. Once production history
exists, changing any of this means rewriting every repo, and with it every
revision ID that clients hold. The ADR also makes `realm_registry.id`
permanent, so a realm keeps its history across every change to its URL.

## 1. Decision

### 1.1. One SHA-256 repo per realm, append-only

A realm's history MUST be a bare git repo at `<historyRoot>/<id>.git`, where
`<id>` is the realm's `realm_registry.id`. The history root MUST be outside
every realm directory. The repo MUST use git's SHA-256 object format. Its only
branch MUST be `refs/heads/main`. The branch MUST move only by
compare-and-swap (`git update-ref` with the expected old value). Each move
MUST be to a commit whose only parent is the commit the branch names, or, in
an empty repo, to a commit with no parent. Code MUST NOT rewrite or remove a
commit that `refs/heads/main` reaches. A realm's history ends only when its
whole repo is deleted.

### 1.2. A realm's registry id never changes

A realm's `realm_registry.id` MUST NOT change while the realm exists. A change
to a realm's URL, such as a rename, a domain move or a migration, MUST update
the realm's row in place and keep its `id`. The update MUST land before any
realm server boots with the new URL, for example in a migration. The boot-time
backfill (`packages/realm-server/lib/realm-registry-backfill.ts`) upserts rows
by URL, so a late update leaves it to insert a second row with a new id, which
starts a second history. A realm that is deleted and created again at the same
URL MUST get a new `id`, and so a new history. A revision MUST NOT record the
realm's URL. Paths in a repo and in its trailers are relative to the realm, so
a URL change touches only the registry row.

### 1.3. Authors and dates

The git author's name and email MUST both be the Matrix user ID of the user
the revision's writes are attributed to, or `boxel-system` for writes no user
made. A revision MUST NOT store a display name. Readers look display names up
when they read history. The committer's name and email MUST both be
`realm-historian`. The author date MUST be the time of the last write the
revision covers. The committer date MUST be the time of the commit.

### 1.4. Trailers carry the metadata

A revision's metadata MUST be its author, its dates, and the `Boxel-*` git
trailers that end its message, which `TRAILERS` in
`packages/runtime-common/realm-history.ts` names. The subject line is display
text, and code MUST NOT read metadata from it. Once revisions carry a trailer,
its name and the meaning and syntax of its value MUST NOT change. New trailers
MAY be added. A reader MUST ignore a trailer it doesn't know.

### 1.5. Size-only entries

A file that history records without its content (a size-only entry) MUST be a
tree at the file's path. The tree MUST hold exactly one blob, named
`.realm-history-size-only`, with the content that `sizeOnlyMarker` in
`packages/realm-historian/src/repo-format.ts` writes: the line
`realm-history-size-only 1`, then the file's size and its `content-hash.ts`
fingerprint. The marker's name is reserved. realm-historian MUST NOT record a
realm path with a segment of that name. A later layout for content that isn't
kept whole, such as chunked storage, MUST use a marker with a name of its own.
It MUST NOT change what a version 1 marker means.

### 1.6. Binaries and blob-store objects

History MUST store a binary file as a blob, like any other file. A realm may
hold a pointer file to an object in a blob store. History MUST record the
pointer file as content, and MUST NOT copy the object. The blob store's
garbage collection MUST keep every object that a pointer file in any of a
realm's revisions references, until the realm is deleted.

### 1.7. One package writes and reads the format

Code outside `@cardstack/realm-historian` MUST NOT write to a history repo. It
MUST read one only through the `RealmHistoryReader` that the package exports.
The package MUST write each revision's objects itself, as loose objects in
git's format. Each object MUST be durable before `refs/heads/main` reaches it:
written to a temporary file, fsynced, and renamed into place. The package uses
the `git` executable for ref updates, reads and maintenance. Maintenance MUST
NOT remove an object that `refs/heads/main` reaches. The package's tests MUST
run `git fsck --strict` over every repo they produce. Measurement on EFS may
call for one pack per commit in place of loose objects. That change MUST amend
this section.

## 2. Rationale

A realm's history is a sequence of snapshots of its files, which is what git
stores. With standard objects, git's own tools do the work:

- reads: a path-filtered `log` over a commit-graph with changed-path Bloom
  filters, `diff-tree` and `cat-file`;
- checks: `fsck --strict` over every repo the tests write;
- storage: `repack` keeps successive versions as deltas;
- diagnosis: an operator can clone a repo read-only.

One repo per realm keeps realms apart. Each realm moves its own
`refs/heads/main` by compare-and-swap, with no lock across realms. Removing a
realm's history means deleting one directory. No realm's history can be
reached through another realm's repo. Because the repos are outside every
realm directory, realm serving, indexing, listing, publish and copy never see
them.

The object format is SHA-256 because realm-historian computes object IDs
itself, and every blob holds bytes that a realm writer chose. Node's SHA-1 has
none of the collision detection that git builds in. Rented GPUs have been able
to produce identical-prefix SHA-1 collisions since 2020 (Sources). Two files
that collided under git's blob framing would share one object:

- history would show one file where the other was written;
- a write could disappear as a no-op;
- a restore would bring back the wrong bytes;
- git's own SHA-1 code would refuse the object, which breaks `fsck` and
  clones of that repo.

SHA-256 costs nothing that matters, because a commit's time goes to EFS round
trips, not to hashing. A SHA-256 repo written the way realm-historian writes
one passes every git operation that history uses, with git 2.35 and 2.54:

- `fsck --strict`;
- a path-filtered `log` with Bloom filters;
- `repack`;
- a clone over dumb HTTP.

git itself plans to make SHA-256 the default for new repos.

The repo is named by `realm_registry.id` for two reasons. The change journal
carries the id, and the id is the one identity a realm keeps when its URL
changes. URLs do change: migration `1779100257124` moved local realms from
`http` to `https`, and it rewrote their registry rows in place. If repos were
named by URL, every URL change would be a repo move. Worse, a realm deleted
and created again at the same URL would inherit the old realm's history. That
history is content its owner chose to destroy, attributed to people who may
have no access to the new realm.

Trailers keep each revision's metadata in the revision, so a repo describes
itself. A crash between a commit and its cursor update, a lease handover, or a
restore from backup can leave the database behind the repo. realm-historian
then reads a revision's `Boxel-Journal-Seq` trailer to find the change events
it covers. The reader needs nothing but the repo. A revision can't be edited:
rewriting it changes its ID and every later ID, and clients hold those IDs.
That is why the trailer meanings, the object format and the key are fixed now,
before production history exists. Matrix user IDs don't go stale the way
display names do, and ADR 011 §1.8 allows history to show them.

A size-only entry is a tree because a tree can't be mistaken for a file's
content. A marker stored as a blob at the file's path would look like a file
with the same bytes. A restored pointer file must still find its object, so
the blob store can't collect an object that a revision references.

One package owns both sides of the format, so the writer and the reader change
together, under one test suite that runs `git fsck --strict` (ADR 018). The
repos hold only paths relative to the realm, so they store no identifier that
ADR 002 governs. The history operations accept card IDs, and they follow
ADR 002 §1.2 and §1.3 when they turn those IDs into paths.

## 3. Considered options

- **One SHA-256 repo per realm, named by registry id (chosen).**
- **The SHA-1 object format.** It is git's default. GitHub and most git
  libraries read only SHA-1, so exporting history to GitHub means converting
  it, which gives the copy new revision IDs. Rejected for the collisions in
  §2.
- **Naming the repo by the realm's URL.** Every URL change would become a repo
  move, and a re-created realm would inherit the history of the realm before
  it.
- **Naming the repo by `disk_id`.** Its meaning differs by realm kind. It also
  changes when an operator moves a bootstrap realm on disk.
- **A `.git` directory inside the realm.** Realm serving, indexing, listing,
  publish and copy would all see it.
- **One repo for every realm, or one per owner.** Realms would contend for one
  ref. Deleting one realm's history would mean rewriting every other realm's
  history in the repo.
- **Metadata in Postgres or in git notes.** The repo would no longer describe
  itself. A commit left by a crash, or restored from backup, couldn't be
  matched to its events. Notes also move on a second ref, which doesn't move
  atomically with `refs/heads/main`.
- **Display names as git authors.** They go stale when a user changes their
  display name, and history can't be rewritten to follow.
- **A size-only entry as a blob at the file's path.** It couldn't be told
  apart from a file whose bytes equal the marker.
- **A long-lived `git fast-import` per active realm.** Making each commit
  readable takes a checkpoint per commit, which is one pack per commit anyway.
  It also needs a process per realm, and puts git, not realm-historian, in
  control of fsync and ref updates.
- **Writing objects with Rust and gix.** A commit's cost is EFS round trips,
  not hashing or compression, which Node already does natively. It would also
  add a second language outside ADR 018.

## 4. Sources

- `packages/realm-historian/src/repo-format.ts` and
  `packages/realm-historian/src/git-objects.ts`: the format as written so far.
- `packages/postgres/migrations/1779100257124_canonical-url-http-to-https.js`:
  the URL change that rewrote registry rows in place.
- G. Leurent and T. Peyrin,
  [SHA-1 is a Shambles](https://sha-mbles.github.io/) (USENIX Security 2020):
  an identical-prefix SHA-1 collision for about US$11k of rented GPU time.
- git's [`sha1dc_git.c`](https://github.com/git/git/blob/master/sha1dc_git.c),
  where `git_SHA1DCFinal` dies on a detected collision, and
  [`BreakingChanges`](https://git-scm.com/docs/BreakingChanges), which plans
  SHA-256 as the default object format for new repos.

## 5. Remediation

Known gaps are listed in [remediation/034.md](remediation/034.md).
