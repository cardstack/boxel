# Style budget — keep `<style>` blocks lean

A common failure mode in agent-generated cards: a single `.gts` file balloons to 800-1000+ lines, half of it copy-pasted CSS across the three formats. Inflates token cost, makes diffs miserable, and hides real structure.

## The rule

**`<style scoped>` content should be ≤ 40% of the file.** If it's higher, you're either:
- duplicating CSS across formats that share visual structure, or
- restyling things the Theme card's tokens should already cover, or
- writing CSS for a one-off detail that doesn't deserve a scoped block.

## Where the bloat actually comes from

Three patterns account for almost all the bloat we see:

### 1. Per-format CSS resets

Each format gets its own `*, *::before, *::after { box-sizing: border-box; }` plus typography baseline plus color reset. **Don't.** Theme tokens already give you `--font-sans`, `--font-mono`, `--background`, `--foreground`. The host wraps your template in a styled container that inherits these.

### 2. Three near-identical block-level scaffolds

`isolated`, `embedded`, and `fitted` all need a card container, a header, content, optionally a footer. If 80% of the CSS is the same between formats, you've got two options:

- **Single `<style scoped>` at file top.** A `.gts` file can declare a single top-level scoped block that covers selectors used in all three format templates. Each format then references shared classes (`.card`, `.card-header`, `.card-body`) — the scoped selectors match because they live in the same .gts module scope.
- **Theme tokens for the shared bits.** Background, border, radius, font-family are theme concerns — set them once via tokens. Per-format CSS should only override layout (grid columns, flex direction, padding).

### 3. Verbose container queries duplicated per format

The `fitted` 4-sub-format pattern (`badge`/`strip`/`tile`/`card`) is intentionally verbose, but the body of each branch tends to repeat the typography/color setup. Keep the branches focused on the **layout differences** (grid template, font-size step) — pull the typography/colors out to shared rules that all branches inherit.

## When wider CSS is justified

- **Heavy interactive UI** (drag-and-drop, complex animations, custom canvas). These have legitimate reasons to be CSS-heavy.
- **Custom typography systems** that go beyond what a Theme card's variables cover (rare; almost always a sign the Theme should be richer).
- **Print stylesheets** or other media-query-heavy contexts.

If you're in this territory, fine — but write `agent-notes.md` explaining why so it's clear the bloat is deliberate.

## A target shape for a `.gts` file

For a typical CardDef (no heavy interactivity):

| File section | Roughly |
|---|---|
| Imports + class field declarations | 60-120 lines |
| Computed fields + cardTitle/cardDescription | 20-50 lines |
| Static templates (isolated + embedded + fitted) — markup only | 80-180 lines |
| `<style scoped>` (or top-level shared block) | 100-250 lines |
| **Total** | **300-500 lines** |

A 700+ line file is a code smell. A 1000+ line file is a bug. Refactor before pushing.

## Quick self-check

Before declaring a card done:

```bash
wc -l my-card.gts
awk '/<style/,/<\/style>/' my-card.gts | wc -l
```

The second number should be at most ~40% of the first. If not, look for duplicated rules across the three format style blocks — those are the first candidates to hoist into a shared block or replace with theme tokens.
