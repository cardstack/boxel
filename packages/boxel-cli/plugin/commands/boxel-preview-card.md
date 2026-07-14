---
name: boxel-preview-card
description: Preview a card, module, or format in the live Boxel app.
boxel:
  kind: skill
---

# /boxel-preview-card

## Use When

- After code edits, to see the resulting card render.
- The user wants to compare formats (`isolated` vs `embedded` vs `fitted`).
- Verifying a fix landed in the app.

## Inputs

- Card URL or module path.
- (Optional) format to preview.

## Read

1. `skills/boxel-environment/SKILL.md`
2. `skills/boxel-environment/references/host-commands-reference.md`

## Procedure

1. In code mode: `preview-format_cb94` opens the module + a card preview side-by-side. This is the default after code edits.
2. In interact mode: `show-card_566f` displays the card in its standard view.
3. To swap between formats inside the preview, use the format selector or invoke `preview-format` with a different `format` argument.

## Done Criteria (self-verify)

- [ ] The card actually renders (no error overlay).
- [ ] If the user named a format, that format is the visible one.
- [ ] If the change was supposed to be visual, confirm the visual differs from the prior state.

## Failure Recovery

- "Module failed to load" → switch to code mode and read the file; there's likely a syntax error from a recent edit.
- "Card not found" → the realm may not be indexed; consider `/boxel-debug-runtime` to check indexing state.
