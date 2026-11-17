---
status: proposed
date: 2026-11-13
scope:
  - packages/realm-server/handlers/**
  - packages/realm-server/lib/**
  - packages/runtime-common/realm.ts
---

# 035. Write card documents into a realm as JSON with 2-space indentation

A card document in a realm is a file that people read: in code mode, in a
download, in a git diff, and in a `boxel` pull. The realm writes a saved card
as JSON with 2-space indentation. Server code that writes a card document
directly to a realm's storage, without the realm's save path, writes the same
form, so that no file in a realm is one long line.

## 1. Decision

### 1.1. Indentation

Server code that writes a card document, such as `realm.json` or `index.json`,
directly to a realm's storage MUST write it as JSON with 2-space indentation.
This is the form `Realm` in `packages/runtime-common/realm.ts` writes when it
saves a card.

### 1.2. One place for the format

New code that writes a card document SHOULD call a serializer that `Realm`
also uses, instead of setting the indentation at the call site.

## 2. Rationale

A realm is a set of files that people edit, not an opaque store. Code mode
shows a card's JSON as stored, and a compact document shows as one line that
is hard to read and edit. Git history and `boxel` sync compare files line by
line, so a compact file also turns each change into a one-line diff of the
whole document. The first save through the realm then rewrites the whole file
to the indented form, which makes a large diff that changes no data.

Most card documents reach storage through the realm's save path, which already
indents them. The documents at risk are the ones the server writes directly,
outside that path: the seed files of a new realm, and `realm.json` updates
while a realm is published. Each such call site chooses its own format, so a
new one can drift to compact JSON. This ADR names the form those call sites
must use.

## 3. Considered options

- **Write the realm's form at every direct write (chosen).** The file in
  storage is the file people see, with no extra step.
- **Write compact JSON, and format it when code mode shows it.** Code mode
  would look right, but downloads, git history and `boxel` pulls would still
  see one line, and the first save would still rewrite the whole file.
- **Write compact JSON, because it is smaller.** Card documents are small, and
  the realm's save path already writes the indented form. Saving a few bytes
  on the few files written outside that path gives no real gain.

## 4. Sources

- PR #7465: `createRealm` writes `realm.json` and `index.json` with 2-space
  indentation.
- `packages/realm-server/handlers/handle-publish-realm.ts`: writes
  `realm.json` with `{ spaces: 2 }`.

## 5. Remediation

Known gaps are listed in [remediation/035.md](remediation/035.md).
