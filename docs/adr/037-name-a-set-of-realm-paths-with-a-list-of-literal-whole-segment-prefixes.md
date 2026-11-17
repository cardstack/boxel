---
status: proposed
date: 2026-11-17
scope:
  - packages/runtime-common/path-specifier.ts
  - packages/runtime-common/serializers/path-specifier.ts
  - packages/runtime-common/realm-history.ts
  - packages/realm-historian/src/reader.ts
---

# 037. Name a set of realm paths with a list of literal, whole-segment prefixes

A policy grant, a search scope, a history read and a binding of files to a
FileDef all need to say "these paths in this realm". They say it one way: a
path specifier, which is a list of literal prefixes such as `["blog/",
"posts/"]`, matched one whole decoded segment at a time against the path as the
realm resolves it. One parser, validator and matcher in runtime-common serves
every such use, so a path means the same thing to the gate, to search and to
history.

## 1. Decision

### 1.1. One implementation

Code that names a set of paths in a realm MUST parse, validate and match it
with `packages/runtime-common/path-specifier.ts`. It MUST NOT add another
syntax or matcher for the same job. Code that lowers a specifier, such as to
an SQL prefix test or a `git log` path filter, SHOULD lower the parsed prefixes
the module exposes rather than parse the strings again. A lowering MUST match
a prefix's `path` literally: an SQL lowering MUST escape `LIKE`'s `%`, `_` and
`\` and compare against the form the index stores a path in, and a `git`
lowering MUST pass literal pathspecs (`--literal-pathspecs`), since a valid
`path` can hold `%`, `_`, `*`, `[` and `]`. A `.gitignore` file
keeps git's own pattern syntax: it says which files a realm leaves out, not
which paths a grant, a search or a read covers.

### 1.2. Syntax

A path specifier MUST be a list of prefixes, each relative to the root of the
realm it is applied to, never to the realm that stores the specifier. A prefix
ending in `/` names a directory and everything in it, a prefix without one
names a single file, and `/` names the whole realm. A leading `/` is optional.
A path matches the specifier when it falls under any of its prefixes. A
specifier that limits something, such as a grant's paths, MUST treat an empty
list as no path limit. A request that lists the paths it reads, such as a
history filter, MAY give an empty list its own meaning, but MUST parse and
match its entries with this module.

### 1.3. Literal prefixes

A prefix MUST be literal: matching it MUST NOT read the caller, a target or the
realm's settings, or evaluate anything. `*` and `:` MUST be refused as written,
so that a pattern form can be added later without changing what any existing
specifier means. A later pattern form MAY match path shapes, but MUST NOT bind
values.

### 1.4. Matching

A specifier MUST be matched against the path as the realm resolves it
(`RealmPaths.local`), never as a caller spelled it. A prefix's percent-escapes
MUST be decoded once, with `decodeURI`, which leaves the escapes of URL
delimiters such as `%3A` encoded, as they are in a resolved path. Matching MUST
compare whole decoded segments, case-sensitively and with no Unicode
normalization, so `blog/` never matches `blog-old/` or `blog.json`. It MUST
run in time linear in the lengths of the path and the prefixes, and MUST NOT
compile an authored string into a regular expression, as ADR 015 §1.3 requires
for routes.

### 1.5. Validation

A prefix MUST be refused when it is empty or has an empty segment, a `.` or
`..` segment (as written or percent-encoded), a backslash, `?`, `#`, a control
character, or a malformed escape. One invalid prefix MUST make the whole
specifier invalid. A consumer MUST NOT drop only the invalid prefixes and use
the rest, because that could leave an empty list, which means no path limit.
A consumer MUST treat an invalid specifier as matching no path, never as
absent or empty, so that it fails closed (ADR 024 §1.6).

### 1.6. Storage

A stored specifier MUST be its list of prefixes as written, or `null` when it
is absent. An absent specifier on a limit means no path limit, as an empty list
does. A stored value that isn't a list of strings MUST be refused, never
read as absent. Reading a stored specifier SHOULD NOT validate its prefixes,
so a card holding an invalid prefix still loads and can be corrected in its
editor; validity is decided where the specifier is used.

## 2. Rationale

The policy gate, search and history each answer "is this path in the set?",
for the same grant. If each parsed and matched paths its own way, a grant could
admit through one route what it refuses through another. A list of whole-segment
prefixes is the form all three can serve fast: search lowers a prefix to an
indexed SQL prefix test, history passes it to `git log` as a path filter, and
the gate compares segments before it reads the index.

Literal prefixes make a policy readable on its own, and let a compile check
grants against each other before any request arrives. Matching the realm's
resolved path, decoded and segment by segment, closes the spellings that would
let a prefix reach past what it names: `%2E%2E`, `blog-old/` under `blog`,
`Blog/` under `blog/`. An invalid prefix fails closed, because the empty list
that remains after dropping it means everywhere.

## 3. Considered options

- **A list of literal, whole-segment prefixes (chosen).** Each use above can
  lower it without reinterpreting it, and it is matched in linear time.
- **A glob with `*` and `**`.** Search can't lower a one-segment wildcard to an
indexed SQL test, the pending-changes query's prefix index can't serve it
either, and `git log` accepts a glob but doesn't use its changed-path Bloom
  filters for one. A glob is also harder to match in linear time.
- **The dynamic-routes segment syntax.** Its `:name` captures exactly one
  segment and can't say "everything under".
- **`startswith` on `.id` in a grant's `where`.** `.id` is the card's absolute
  URL, so the test breaks when the realm's URL changes, and it can't judge a
  create, a data file or a search.
- **A specifier that reads the caller or the realm's settings,** such as
  `users/{actor()}/`. A reader couldn't tell from the policy what it grants,
  overlap and coverage couldn't be checked at compile time, and the gate
  couldn't match a path before evaluating predicates. Scoping by caller belongs
  in a grant's `where`.
- **One prefix instead of a list.** "Within `blog/` or `posts/`" would need two
  grants, and turning one string into a list later would mean migrating every
  stored specifier.
- **Dropping only an invalid prefix.** It could leave an empty list, which
  means no path limit.
- **Matching the caller's spelling of a path, or folding case.** Either one
  lets a prefix admit paths its author didn't name.
- **Decoding every escape, `decodeURIComponent`-style.** The realm leaves the
  escapes of URL delimiters such as `%3A` encoded when it resolves a file path,
  so a prefix decoded that way could name a different file than a URL with the
  same path.
- **Storing the prefixes as `containsMany(StringField)`.** Its default editor
  accepts an empty or invalid entry without a warning, its empty view hides that
  the specifier then means everywhere, and nothing refuses a malformed value.

## 4. Sources

- `packages/runtime-common/route-pattern.ts`: the segment model and the
  linear-time, regex-free matching this specifier follows.
- `packages/runtime-common/paths.ts`: `RealmPaths.local`, the resolved path a
  specifier is matched against.
- `packages/runtime-common/serializers/policy-predicate.ts`: the refusal of a
  malformed stored value that §1.6 follows.

## 5. Remediation

Known gaps are listed in [remediation/037.md](remediation/037.md).
