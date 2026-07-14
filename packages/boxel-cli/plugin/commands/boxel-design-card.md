---
name: boxel-design-card
description: Improve a card's visual design — colors, typography, mood, asset direction, theme tokens.
boxel:
  kind: skill
---

# /boxel-design-card

## Use When

- The user says "make this look better", "redesign", "more modern", "more playful", "match brand X".
- Visual concerns dominate the request, even if some template editing follows.

## Inputs

- Path to the `.gts` file.
- The design intent (mood, brand, audience, reference inspirations).
- Whether a theme card is involved.

## Read

1. **`skills/boxel-patterns/patterns/theme-first-workflow/README.md`** — the Theme card structure + `cardInfo.theme` linkage.
2. `skills/boxel-theme-development/SKILL.md` if the task creates or changes the Theme/StyleReference/BrandGuide artifact itself.
3. `skills/boxel-design/SKILL.md`
4. `skills/boxel-ui-guidelines/SKILL.md`
5. `skills/boxel/SKILL.md` (focus: `references/theme-design-system.md`, `references/styling-design.md`, `references/core-concept.md` for the cardInfo/theme system)

## Procedure

1. **Step 0 — Confirm the Theme.** Check whether `cardInfo.theme` is set on representative instances. If not, this is the first thing to fix — no amount of `<style scoped>` polish will land coherently without a Theme card to anchor it.
   - **Reuse:** find an existing Theme card in the target realm via `npx boxel search` or `/boxel-search-cards`.
   - **Copy and edit:** copy an existing Theme, change `cssVariables` (the `:root` and `.dark` CSS blocks) and `cssImports` (Google Fonts URLs).
   - **Create:** new Theme card adopting from `https://cardstack.com/base/style-reference` (richer — has `visualDNA`, `inspirations`, structured `rootVariables`) or extending `Theme` directly (`cssVariables` + `cssImports`).

2. Run the design discovery process from `boxel-design`: mood, audience, references, distinctive angle. Use those to inform the Theme card's `visualDNA` + `cssVariables`.

3. Link `cardInfo.theme` on every relevant instance:

   ```json
   "relationships": {
     "cardInfo.theme": {
       "links": { "self": "../Theme/<name>" }
     }
   }
   ```

   The relationship key has a literal dot — `"cardInfo.theme"`, not nested.

4. Update templates' `<style scoped>` blocks to reference only theme tokens (`var(--background)`, `var(--card)`, `var(--primary)`, `var(--font-sans)`, etc.). Strip any hard-coded colors.

## Done Criteria (self-verify)

- [ ] A Theme card exists in the realm and is linked from each affected instance via `cardInfo.theme`.
- [ ] No hard-coded colors outside the Theme card's `cssVariables` string (`grep -E '#[0-9a-fA-F]{3,8}' <file>` — review hits).
- [ ] Templates reference `var(--*)` tokens only (no `color: '#7b61ff'` in `<style scoped>`).
- [ ] Typography uses `var(--font-*)` tokens; if a Google Font is needed, the URL is in the Theme card's `cssImports`, not inlined in the template.
- [ ] At least `isolated`, `embedded`, AND `fitted` formats are styled (don't leave a card with bare fitted).

## Failure Recovery

- "Looks the same after edit" → check that the instance has `cardInfo.theme` set; without it, the Theme's CSS variables aren't injected.
- "Theme card not applying" → confirm the linked Theme exists at the URL in `cardInfo.theme.links.self`; confirm `cssVariables` includes `:root { ... }` selectors.
- "Style changes work locally but not after sync" → the realm needs to re-index the Theme card after `cssVariables` updates. Use `/boxel-debug-runtime` or `npx boxel realm cancel-indexing` + manual re-trigger.
