---
name: boxel-development
description: Use when working on Boxel card development, especially creating or editing `.gts` card definitions, `.json` card instances, Boxel commands, themes, queries, templates, or related Boxel patterns in a synced workspace. Read the targeted files in `references/` instead of loading broad guidance by default.
---

# Boxel Development

Use this skill for Boxel card and app development. Keep the top-level guidance lean and load only the references needed for the task.

## Core Workflow

1. Confirm whether the task is about a card definition, card instance, query, command, theme, file asset, or styling.
2. Read only the specific reference files that match the task.
3. For file placement, naming, or `adoptsFrom.module` paths, also read `../boxel-file-structure/SKILL.md`.
4. Apply the rules from the relevant references exactly when they are marked critical.
5. Ignore Boxel in-app editor instructions unless you are explicitly operating inside that environment. In this repo, prefer normal filesystem edits and CLI workflows.

## Always Load First

- `references/dev-core-concept.md`
- `references/dev-technical-rules.md`
- `references/dev-quick-reference.md`

These three files establish the data model, the `contains` vs `linksTo` rule, required formats, inherited fields, and common import patterns.

## Load By Task

- Card structure and safe patterns:
  `references/dev-core-patterns.md`
- Templates, delegated rendering, and field access:
  `references/dev-template-patterns.md`
  `references/dev-delegated-rendering.md`
- Styling and themes:
  `references/dev-theme-design-system.md`
  `references/dev-styling-design.md`
  `references/dev-fitted-formats.md`
- Queries and data linking:
  `references/dev-query-systems.md`
  `references/dev-data-management.md`
- File-backed content and file asset cards:
  `references/dev-file-def.md`
- Enum fields:
  `references/dev-enumerations.md`
- Defensive component logic:
  `references/dev-defensive-programming.md`
- Third-party libraries:
  `references/dev-external-libraries.md`
- Command implementation:
  `references/dev-command-development.md`
- Spec usage:
  `references/dev-spec-usage.md`
- Replicate integration:
  `references/dev-replicate-ai.md`

## Usually Ignore Unless Explicitly Relevant

- `references/dev-file-editing.md`
  This is primarily for Boxel's in-app AI editing flow, not normal terminal-based editing.

## Key Reminders

- `CardDef` and `FileDef` references use `linksTo` / `linksToMany`.
- `FieldDef` values use `contains` / `containsMany`.
- Modern cards should implement `isolated`, `embedded`, and `fitted`.
- Be precise with relative JSON module paths.
- Prefer loading one or two reference files over reading the whole reference set.
