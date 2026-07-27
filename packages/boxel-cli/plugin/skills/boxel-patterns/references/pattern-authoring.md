# Pattern Authoring Guide

For **adding, promoting, or maintaining** patterns in this tree. Agents *using* patterns to build cards don't need this file — the routing catalogue in `../SKILL.md` is enough.

## Pattern folder shape

Each `patterns/<slug>/` is:

```
patterns/<slug>/
├── README.md     # When to use, why this beats the obvious approach, gotchas, source realm + file
└── example.gts   # Minimal compilable example — pattern essence only, no domain noise
```

A small set of Ready Patterns omit `example.gts` and keep the worked code in fenced blocks inside the README. They are marked `(README-only)` in the Ready Patterns list. This is acceptable when the recipe is a few-dozen lines and the README's discussion gives it adequate context.

## README template

```markdown
---
validated: source-proven
---

# <slug> — <one-line outcome>

**What this gives you:** <user-facing sentence>

**When to use:** <task triggers>

**The insight:** <the non-obvious part — what someone would miss if they wrote it themselves>

**Gotchas:** <traps>

## Recipe shape

<the skeleton of the implementation — key imports, class shape, the load-bearing lines. For (README-only) patterns this section carries the full worked code.>

**Source:** <realm/file.gts:line-range>

## See also

<related patterns and skill references, one line each>
```

`Recipe shape` and `See also` are part of the standard shape — most existing patterns carry them. Bespoke extra sections (`Data shape`, `Quality bar`, …) are fine when a pattern genuinely needs them, but prefer the standard headings first.

## Naming conventions

Filenames are how agents discover content. Stick to these:

- **Pattern slug = verb-first taxonomy.** Use one of: `show-`, `pick-`, `build-`, `automate-`, `layout-`, `link-`, `integrate-`, `command-`, `organize-`, `theme-`, `format-`. The verb names the *outcome*, not the underlying class. A few topic-prefix slugs (`cardinfo-`, `containsmany-`, `polymorphic-`, `resource-`, `app-card-`, `bxl-`, `library-`, `surface-`) are kept when the topic is more identifying than the verb — pick verb-first by default and only deviate when the topic is the canonical entry point.
- **Slug = lowercase, hyphen-separated, descriptive.** Aim for 3–5 words. Long enough to be recognizable in a grep result, short enough to read in a file-tree tooltip.
- **One pattern per slug folder.** Every pattern folder contains exactly `README.md` (the instructions) and optionally `example.gts` (the code). No third file unless you have a specific reason; if you do, name it descriptively (e.g. `api-notes.md`, not `notes.md` or `extra.md`).
- **Filename inside the folder is the role, not the topic.** `README.md` always means "read this first." `example.gts` always means "the worked code." Don't put the slug in the filename — the directory already does.
- **No duplicate filenames across the tree.** Two references named the same thing confuse agents and cross-references. Disambiguate by domain (`template-syntax.md` for Glimmer syntax patterns; `template-patterns.md` for UI template patterns).
- **References live under a skill.** Pattern READMEs cross-link references via path: `boxel/references/<topic>.md`. References don't have an `example.gts`; their job is to explain mechanics, not ship recipes.
- **`SKILL.md` is the skill entry point.** Every skill folder has exactly one `SKILL.md`. References live under `<skill>/references/<topic>.md`. Don't create a second `SKILL.md` or rename it.
- **Commands use the `boxel-` prefix.** Every action command in `commands/` is `boxel-<verb>.md` so they cluster together in slash-command menus. Exception: cross-cutting commands (`distill-learnings.md`).

## Validation frontmatter

Every pattern README opens with a `validated:` field:

- **`linted`** — the `example.gts` has been compiled and lint-checked against a live realm with `boxel-cli`. Highest confidence. Promote here only after running the lint gate.
- **`source-proven`** — the pattern was extracted from a live, working realm. The example may not have been linted in isolation, but the mechanics are known to work in a real card. Default for ready patterns.
- **`sketch`** — the README captures the shape but the worked code has not been extracted from a live realm. Pair with a 🟡 Status banner at the top of the README and call out in the Ready Patterns intro that the slug is a draft. Do not adapt directly.
- **`deprecated`** — the pattern has been superseded by another approach. The README still ships so older callers can find the migration path.

Update the field as a pattern's status changes (sketch → source-proven → linted, or any → deprecated).

## Promotion bar — when to add a new ready pattern

Promote a realm discovery into `boxel-patterns/` only when it captures **mechanics that agents are likely to miss** without explicit guidance:

- Non-obvious **imports** (named vs default exports, base-realm URLs that look wrong, FileDef subtypes with hidden extension rules).
- **Host commands** that need specific argument shapes or composition.
- **FileDef wiring** (`linksTo(MarkdownDef)`-style relationships with extension-bearing paths, `WriteBinaryFileCommand` → `ImageDef` shape).
- **Lifecycle cleanup** (Glimmer modifiers that allocate browser resources — WebGL, WebAudio, large libraries).
- **Query / delegated-render traps** (the silent-zero-rows kind; the chrome contract surprises).

**Don't add a pattern just because**:

- The card is visually attractive.
- The demo is polished.
- The implementation is something a competent web dev could rediscover from common knowledge (button + tracked state + animation — that's vibe-codable).

Visually nice but mechanically simple cards stay as **source-realm references** or **inspiration notes** — they don't need a ready slot. The ready tree should be reserved for reusable mechanics that are hard to rediscover correctly. Apply this especially when reviewing catalog-realm demos: prefer FileDef-backed media, PDF.js text-layer annotation, command wiring, library lifecycle, and query/delegated-render traps over ordinary card layout or styling examples.

For any pattern or reference that imports `@cardstack/boxel-host/tools/<name>`, run the host-command audit before promoting it:

```sh
BOXEL_MONOREPO=/path/to/boxel node skills/boxel-patterns/scripts/audit-host-command-refs.mjs
```

The audit compares skill-tree command imports with `packages/host/app/tools/index.ts` in the live monorepo. A missing command import is a blocker for Ready Patterns unless the monorepo has changed and the audit is refreshed.

## Backlog

Reserved-but-unextracted slugs live in `pattern-backlog.md`. Move a slug from the backlog into Ready Patterns (with its README + example) when it clears the promotion bar.
