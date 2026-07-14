---
name: boxel-build-from-pattern
description: Start from an existing ready pattern — list patterns by outcome, or adapt a chosen one to the user's domain.
boxel:
  kind: skill
---

# /boxel-build-from-pattern

## Use When

- The user describes an OUTCOME ("show a chart", "let users pick a color", "build a quote document", "embed AI image generation", "lay out a moodboard") rather than a class hierarchy.
- They ask "do we have an example of…" or "how is X typically done in Boxel?".

## Inputs

- The user's outcome in plain language.
- (Optional) which realm they want to apply this in.

## Read

1. `skills/boxel-patterns/SKILL.md` — the intent taxonomy.
2. After picking a pattern, its `patterns/<slug>/README.md` and `patterns/<slug>/example.gts`.
3. The pattern's "See also" section — usually points to one or two supporting skills.

## Procedure

**Discovery mode** — user described an outcome, doesn't know what's available:

1. Map the outcome to an intent group in the taxonomy (Show / Let users / Build / Automate / Lay out / Link / Collaborate / Use library / Integrate / Organize / Make Command / Theme).
2. List the **Ready Patterns** in that group with one-line outcomes. Skip planned entries.
3. Ask the user which pattern matches (or pick one if obvious).

**Application mode** — user named a specific pattern, or one is now chosen:

1. Read `patterns/<slug>/README.md` for when/why/insight/gotchas.
2. Read `patterns/<slug>/example.gts` for the code shape.
3. Adapt to the user's domain — replace placeholder names, data, and styling.
4. Apply via `/boxel-create-card` or `/boxel-edit-template` flow.

## Done Criteria (self-verify)

- [ ] The chosen pattern is from the **Ready Patterns** section, not the Planned backlog.
- [ ] The adaptation preserves the pattern's "insight" (the non-obvious bit the pattern is teaching).
- [ ] Imports match the pattern (especially library imports from `https://realms-staging.stack.cards/ctse/common-libs/...`).
- [ ] The user's domain replaces the example's placeholders, not the other way around.

## Failure Recovery

- No matching pattern → fall back to the core skills (`boxel`, `boxel-ui-guidelines`, `boxel-design`) and write from scratch.
- Pattern looks outdated → check `BSL-STUDY-V3.md` in the `familiar-turkey` realm for the latest syntax, especially `commands/ai-assistant` vs older `commands/use-ai-assistant`. Ask the user for the current URL.
