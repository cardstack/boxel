---
name: boxel-debug-runtime
description: Diagnose runtime, indexing, command, or mode issues in the live Boxel app.
boxel:
  kind: skill
---

# /boxel-debug-runtime

## Use When

- A card won't render or shows an error overlay.
- Indexing is stuck or stale.
- A host command is failing with an unhelpful JSON error.
- The user says "something's broken" without naming the cause.

## Inputs

- The symptom (error message, blank screen, stale data, etc.).
- Where it happens (which card, which realm, which mode).

## Read

1. `skills/boxel-environment/SKILL.md`
2. `skills/boxel-environment/references/common-errors.md`
3. `skills/boxel-environment/references/indexing-operations.md`
4. If the cause turns out to be in code: `skills/boxel/SKILL.md`.

## Procedure

1. Gather context — current workspace, mode, attached card(s), recent edits.
2. If the user message starts with `debug`, output the context dump (see `boxel-environment` debug mode).
3. Match the symptom:
   - **JSON tool-call error** → cross-check with `references/common-errors.md`.
   - **`Cannot read properties of null (reading 'manager')`** → likely an HTML-tag-shadowing block param; see `boxel/references/template-syntax.md`.
   - **Indexing stale** → `invalidate-realm-identifiers_xxxx` for specific resource identifiers, or `reindex-realm_xxxx` for the whole realm.
   - **Card module won't load** → switch to code mode and read the file; look for syntax errors from recent SEARCH/REPLACE edits.
4. Once the cause is identified, propose the fix or escalate to the appropriate command (`/boxel-edit-template`, `/boxel-add-field`, etc.).

## Done Criteria (self-verify)

- [ ] Root cause named (not just "I tried X and it worked now").
- [ ] If a fix was applied, the symptom no longer reproduces (verify via `/boxel-preview-card` or re-running the failing query).
- [ ] If the cause was indexing, the affected URLs are now indexed.
- [ ] User understands what happened (one-sentence explanation).

## Failure Recovery

- Can't reproduce → ask the user for exact reproduction steps.
- Loop detected (same commands repeating) → STOP and tell the user. Don't barrel forward.
