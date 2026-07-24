---
name: boxel-skill-authoring
description: Use when creating or editing a user-authored Boxel skill — a markdown file whose `boxel.kind: skill` frontmatter makes it loadable by AI assistant rooms. Covers the SKILL.md format contract, the frontmatter schema, tool declarations (codeRef forms, requiresApproval), placement conventions, and how to verify the skill indexed correctly. Activates for "write me a skill", "add a tool to my skill", or a skill that isn't showing up in the skill chooser.
boxel:
  kind: skill
---

# Authoring Boxel Skills

_The SKILL.md format contract, its one silent trap, tool declarations, and the verify loop._

A skill is a markdown file. The YAML frontmatter declares what it is; the body is the instructions the assistant loads. Nothing else is required — no card definition, no registration step. The realm indexes the file on save and it becomes choosable in AI assistant rooms.

## The format

```markdown
---
name: trip-planner
description: Plans multi-stop trips. Use when the user asks for an itinerary.
boxel:
  kind: skill
---
# Trip Planner

When the user asks for an itinerary, first ask for their dates and budget...
```

- `name` — short slug-like identifier, shown in the skill chooser.
- `description` — one or two sentences; this is what the assistant reads to decide the skill is relevant, so write it as "Use when…".
- `boxel.kind: skill` — what makes the file a skill. Everything under the `boxel:` key is Boxel-specific; top-level keys are shared conventions (same as Claude Code skills).
- Body — plain markdown instructions. Relative links to other files in the workspace are fine; they resolve against the skill file's own URL.

## ⚠️ The one silent trap

`kind: skill` must be nested under `boxel:`. A top-level `kind: skill` is not an error — the file indexes happily as plain markdown, never appears in the skill chooser, and nothing tells you why. If a skill "isn't showing up", check this first.

## Placement

Convention: `skills/<slug>/SKILL.md` in the workspace, one directory per skill (reference files can sit alongside). This is only a convention — discovery is by the indexed `kind` field, not the path — but following it keeps workspaces legible and matches how synced harness skills are laid out.

## Declaring tools

A skill may give the assistant tools via `boxel.tools`:

```yaml
boxel:
  kind: skill
  tools:
    - codeRef:
        module: '@cardstack/boxel-host/tools/switch-submode'
        name: default
    - codeRef:
        module: ../../my-tools/plan-trip
        name: default
      requiresApproval: false
```

- `codeRef.module` takes a host package specifier (`@cardstack/boxel-host/tools/...`), an absolute URL to a realm-hosted tool module, or a path relative to the skill file.
- `codeRef.name` is the module export (usually `default`).
- `requiresApproval` — omit it and the user must approve each invocation; only an explicit `false` lets the tool auto-execute. Prefer omitting it unless the tool is unquestionably safe to run unattended.

## Verify after writing

Saving the file triggers incremental indexing; within a moment the skill should appear in the room's skill chooser (and its tools become usable per the room's discovery model). If it doesn't:

1. Re-check the `boxel:` nesting (the silent trap above).
2. Check the realm's indexing findings — the `_indexing-errors` endpoint on the realm (or `boxel realm indexing-errors` from a boxel-cli session) reports `frontmatter-error` (YAML didn't parse; the body indexed without it) and `tool-schema-error` (a declared tool's module wouldn't load or its schema generation failed; the skill works, that tool doesn't).

Editing an existing skill needs no extra step: the file reindexes on save and consumers read the fresh content.
