---
status: proposed
date: 2026-11-10
scope:
  - packages/base/card-api.gts
  - packages/runtime-common/search-intent.ts
  - packages/runtime-common/query-engine/filter-sql.ts
  - packages/runtime-common/query-engine/filter-compiler.ts
  - docs/search.md
---

# 048. Match file paths with path-aware globs

A realm's files (modules, markdown, text, JSON, CSV) are searched like cards.
People find them by path: `**/components/*.gts`. So `pattern` reads a glob
the way a shell does, with `*` and `?` inside one path segment and `**`
across segments, and every file is found by its `url` and `name`, which base
`FileDef` declares pattern-searchable. Globs over a file's `content` are left out;
words in content are found with `matches`. The rules are in
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

## 3. Considered options

- **Path-aware globs on `url` and `name` (chosen).**
- **`*` matches across `/`.** Simpler to compile, but it is not how paths are
  read anywhere else.
- **Globs over content with a trigram index.** Fast for rare terms, seconds
  for common ones, and it slows every path glob.

## 4. Remediation

Known gaps are listed in [remediation/043.md](remediation/043.md).
