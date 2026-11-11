---
status: proposed
date: 2026-11-10
scope:
  - packages/base/card-api.gts
  - packages/base/file-content-cap.ts
  - packages/base/csv-file-def.gts
  - packages/base/markdown-file-def.gts
  - packages/base/text-file-def.gts
  - packages/base/ts-file-def.gts
  - packages/base/json-file-def.gts
  - packages/runtime-common/search-intent.ts
  - packages/runtime-common/query-engine/filter-sql.ts
  - packages/runtime-common/query-engine/filter-compiler.ts
  - docs/search.md
---

# Match file paths with path-aware globs, and cap the file content the index holds

A realm's files (modules, markdown, text, JSON, CSV) are searched like cards.
People find them by path: `**/components/*.gts`. So `pattern` reads a glob
the way a shell does, with `*` and `?` inside one path segment and `**`
across segments, and every file is found by its `url` and `name`, which base
`FileDef` declares pattern-searchable. A file's text goes into the index as
`content`, and a large file rewritten on every edit would bloat the index
and every write, so the index holds at most 1 MiB of a file's text, and of a
CSV its header and first 1,000 rows. Globs over content are left out; words
in content are found with `matches`. The rules are in
[Search](../search.md#globs-pattern).

## 1. Decision

### 1.1. Globs are path-aware

In `pattern`, `*` MUST match any run of characters within one
`/`-separated segment, `?` one character other than `/`, and `**` any run,
across segments. A glob MUST match the field's whole value, ignoring case.
A glob the database cannot compile MUST be refused with `limit-exceeded`.

### 1.2. Every file is found by its path and name

Base `FileDef` MUST declare `url` and `name` with `search: { patterns: true }`,
so every file type is pattern-searchable by both, through the declaration
mechanism authors use. A `pattern` or `regex` on any other field of a file
type MUST be refused with `needs-declaration`.

### 1.3. No globs over file content

A file's `content` MUST NOT be pattern-searchable. A file's words MUST be
found through `matches`.

### 1.4. The index holds a bounded head of a file

A file's `content` in the index MUST hold at most the file type's
`contentMaxBytes` (1 MiB for code, markdown, text and JSON), cut at a whole
line where one fits, else at a UTF-8 boundary. A CSV MUST hold its header and
first `contentMaxRows` rows (1,000) within that cap; its columns and row
count MUST still describe the whole file. A log keeps its own tail rule
([ADR index-a-logs-lines-as-they-are-appended-and-grant-them-per-realm-stamped-actor](proposed-index-a-logs-lines-as-they-are-appended-and-grant-them-per-realm-stamped-actor.md)). A file type MAY lower its cap and MUST NOT remove it.

## 2. Rationale

A path glob in which `*` crosses `/` finds `src/a/b/c.gts` for
`src/*.gts`, which no one who has used a shell expects. `pattern` was new in
Query V2, so the shell's reading costs no saved query. Declaring `url` and
`name` on base `FileDef` uses the same switch an author uses, so the engine
has no special case for files.

A glob over content was measured and rejected. A selective term over 1,000
large files answered in 3 to 10 ms, but a term most files hold read every
file's text twice (5 to 11 seconds), and putting content in the pattern
index slowed every path glob from 0.2 ms to 4.5 seconds. The full-text index
behind `matches` finds words in large documents.

The largest code and markdown files in real realms are a few hundred
kilobytes, so a 1 MiB cap holds them whole. Without a cap, a 100 MB CSV
wrote a 29 MB row and took nearly a second per edit; its head takes a few
milliseconds and describes the file.

## 3. Considered options

- **Path-aware globs on `url` and `name`, capped content (chosen).**
- **`*` matches across `/`.** Simpler to compile, but it is not how paths are
  read anywhere else.
- **Globs over content with a trigram index.** Fast for rare terms, seconds
  for common ones, and it slows every path glob.
- **No cap, or a cap per realm.** The index and every edit pay for the
  largest file; a per-realm cap gives one file different answers in
  different realms.

## 4. Remediation

Known gaps are listed in [remediation/proposed-match-file-paths-with-path-aware-globs-and-cap-the-file-content-the-index-holds.md](remediation/proposed-match-file-paths-with-path-aware-globs-and-cap-the-file-content-the-index-holds.md).
