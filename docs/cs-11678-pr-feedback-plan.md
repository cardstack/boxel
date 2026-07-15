# CS-11678 — PR #5444 review-feedback plan

Addresses all feedback on **PR #5444 "Render the broken-ref visual in the
markdown-embed chooser"**. Design reference: Zeplin _"DETAILED ERROR MESSAGE FOR
BROKEN/MISSING CARD V2"_ (saved at `.context/design/broken-card-v2.png` +
`broken-card-v2-spec.md`).

Guiding principle for this round (per request): **reach for an existing
`--boxel-*` token before any literal value.** Literals are kept only where the
design specifies a fixed device pixel with no matching token (the 350 px panel
width, 155/600 px height envelope) or where a two-tone SVG can't express a single
theme colour. Each such exception is called out below.

---

## Feedback inventory

| #   | Source             | Location                   | Item                                                                                                                                   |
| --- | ------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Burcu              | `broken-link/index.gts:89` | Bake fill/stroke into the warning SVG, optimize, move to boxel-ui **raw-icons**                                                        |
| 2   | Burcu              | `broken-link/usage.gts:15` | Rename `noun`→`itemType`, `typeName`→`displayName`; fall back to capitalized `itemType`; derive `itemType` from payload where possible |
| 3   | Burcu              | review body                | Match all CSS to the design; use **our context button** for the overlay ×                                                              |
| 4   | Codex (P2)         | `preview/index.gts:256`    | Broken **inline** ref previews as a block; route it through the inline wrapper so placement matches serialization                      |
| 5   | Copilot            | `preview/index.gts:172`    | `brokenErrorDoc` returns a fresh `{}` each render — use a stable const                                                                 |
| 6   | Copilot (low-conf) | `broken-link/index.gts:50` | `noun` typed `string`; narrow to a union — folded into #2                                                                              |

---

## Item 1 — Warning icon → boxel-ui raw-icon

**Today:** an inline `WarningIcon` TOC (`index.gts:89-128`) draws a two-tone
amber triangle + black `!`, triangle filled via `var(--boxel-warning-200,#ffba00)`.

**Target:** a committed raw SVG with fill/stroke **baked in**, compiled through the
boxel-ui icon pipeline.

- Author `packages/boxel-ui/addon/raw-icons/warning-triangle-filled.svg` (kebab
  name; avoid the existing generic `warning.svg`). Two paths + circle, each with an
  **explicit per-path `fill`/`stroke`** — SVGO drops a root `fill`, so colour must
  live on each path (the `google-color.svg` precedent).
- Run `pnpm rebuild:icons` from `packages/boxel-ui/addon`; commit both the raw SVG
  and the regenerated `src/icons/warning-triangle-filled.gts` + updated
  `src/icons.gts`.
- Replace the inline `WarningIcon` usages (reveal trigger `@size='17'`, overlay
  title `@size='16'`) with `<WarningTriangleFilled width=.. height=..>`.
- Delete the inline `WarningIcon` TOC.

**Colour decision (needs confirmation — see Open Decisions):** the design triangle
is `#ffa515`; the nearest token is `--boxel-warning-200` = `#ffba00`. Because a
two-tone icon can't be driven by the single `--icon-color` var and Burcu asked for
baked colour, the SVG will hardcode the triangle fill + `#1a1a1a` mark. This is the
one deliberate departure from "use a token". Proposed baked value: **`#ffa515`**
(design), unless we prefer to bake the existing token's `#ffba00` for brand
consistency.

## Item 2 + 6 — Prop rename & type-narrowing

Rename across the component and **every** call site:

- `noun` → **`itemType`**, typed `'card' | 'file'` (was `string`) — resolves #6.
- `typeName` → **`displayName`** (stays optional `string`).
- Fallback: label + headline use `displayName ?? capitalize(itemType)`
  (so a missing `displayName` yields "Card"/"File", replacing today's hardcoded
  `'Card'`/`'card'` defaults). `itemType` defaults to `'card'`.
- `itemType` is already known at each call site (base `linksTo` = always `'card'`;
  the chooser's `tab-panel` computes card-vs-file). Keep it caller-supplied — that
  _is_ deriving it from the payload; no heuristic sniffing of `errorDoc`.

**Files:**

- `packages/boxel-ui/addon/src/components/broken-link/index.gts` — args, getters
  (`itemType`, `displayName`, `headline`, `capitalize` helper), template.
- `packages/boxel-ui/addon/src/components/broken-link/usage.gts` — tracked props,
  `Args.String` panels, `@options`.
- `packages/boxel-ui/addon/src/components.ts` — exported type names if any change.
- Base: `card-api.gts:1609`, `links-to-editor.gts:116`,
  `links-to-many-component.gts:311,467,725` — pass `@displayName` + `@itemType='card'`.
- Host: `preview/index.gts` (`brokenTypeName`→`brokenDisplayName`,
  `brokenNoun`→`brokenItemType` args at :130-131, :258-259, :295-296),
  `pane.gts:47-48,164-165`, `tab-panel.gts:224-233,328-329`.
- Tests: `broken-link-template-test.gts`, `broken-link-test.gts` (boxel-ui
  test-app), `markdown-embed-preview-test.gts`, and any snapshot referencing the
  old arg names.

## Item 3 — CSS conformance + context-button ×

### 3a. CSS mapping (design value → token to use)

Most of the component already uses tokens. Concrete changes:

| Element                   | Design           | Action                                                                                                               |
| ------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Atom pill height          | 28 px            | already `min-height:28px` ✓ (design-fixed literal, keep)                                                             |
| Atom label↔icon gap       | 10 px            | already `gap:10px` ✓ (design-fixed, keep)                                                                            |
| Atom pill radius          | 5 px             | switch `--boxel-border-radius-sm` (6px) → **`--boxel-border-radius-2xs`** (5px)                                      |
| Section box/header radius | 5 px             | `status-badge`/`diagnostics` use `--boxel-form-control-border-radius` (10px) → **`--boxel-border-radius-2xs`** (5px) |
| Section header bg         | `#f4f4f4`        | already `--boxel-light-100` ✓ (confirm value)                                                                        |
| Section/panel hairline    | `#d1d1d1`        | already `--boxel-200` ✓                                                                                              |
| Panel radius              | 8 px             | keep **`--boxel-border-radius`** (10px) — no 8px token; 2px, tokenised over literal                                  |
| Panel width               | 350 px           | keep literal (design "FIXED PANEL WIDTH") ✓                                                                          |
| Panel min/max height      | 155 / 600 px     | keep `--bl-min-h`/`--bl-max-h` literals ✓                                                                            |
| Panel shadow              | `0 4 10 /25%`    | keep **`--boxel-deep-box-shadow`** ✓                                                                                 |
| Title / body fonts        | Plex Sans / Mono | already `--boxel-font-*` + `--boxel-monospace-font-family` ✓                                                         |

Net: only the two radius swaps to `--boxel-border-radius-2xs` are real edits; the
rest already conforms. Verify each `--boxel-light-100`/`--boxel-200` value against
the spec during implementation and adjust the token choice if a nearer one exists.

### 3b. Overlay × → `ContextButton`

**Architectural note (flag):** the reveal is a **pure-CSS disclosure** — the ×
today is `<label for={{toggleId}}>×</label>` that toggles the checkbox with no JS.
`ContextButton` renders a real `<button>`, not a `<label>`, so it can't toggle the
checkbox by `for=`. Plan:

- Render `<ContextButton @icon='close' @label='close' @variant='ghost' {{on 'click' this.close}} />`
  (matches the `stack-item.gts` precedent, which uses `@variant='primary-dark'`).
- Add a `close` action that unchecks the toggle input (`input.checked = false`) —
  small, contained JS; the trigger stays a CSS `<label>`, only the close becomes a
  button. Keeps keyboard/ARIA semantics the plain `×` glyph lacked.
- Drop the `.overlay-close` label styles; let `ContextButton` carry its own.

## Item 4 — Inline broken preview placement (Codex P2)

In `preview/index.gts`, the broken branch renders `<BrokenLinkTemplate>` **directly**
(inside the `<p>` at :255-265 and bare at :292-303), while resolved embeds go through
`Embed`, which wraps inline non-atom formats in an `inline-block` span
(`markdown-embed-preview--inline-embed`). So a broken `:card[url | embedded]` inline
ref previews as a block even though it serializes inline.

**Fix:** mirror the `Embed` inline placement for the broken template — wrap it in the
same inline `<span>` + classes when `kind==='inline'` and format isn't atom
(atom is already `inline-flex` in `BrokenLinkTemplate.atom`). Cleanest: teach `Embed`
to accept the broken template as its body (or extract the wrapper markup so both
paths share it) rather than duplicating class strings. Add a preview test asserting
an inline embedded broken ref previews `inline-block`, not block.

## Item 5 — Stable empty errorDoc (Copilot)

`preview/index.gts:170-172` returns `this.args.errorDoc ?? {}` — a new object each
render. Replace with a module-level `const EMPTY_ERROR_DOC: BrokenLinkErrorDoc = {}`
(frozen) and return that on the fallback path. Trivial.

---

## Open decisions (need your call before I start)

1. **Baked icon colour** — `#ffa515` (design) vs `#ffba00` (`--boxel-warning-200`
   value)? Baking is required per Burcu; only the value is in question.
2. **Panel radius** — accept 10px (`--boxel-border-radius`) for tokenisation, or
   introduce a literal `8px` to match the design exactly?
3. **"Open anyway" pill** — design shows a fully-rounded (radius 100) pill; we
   currently use boxel `Button @kind='secondary' @size='small'`. Keep the standard
   Button (recommended, consistency) or override to a pill radius?
4. **PR scope** — confirm the V2 **error panel** (scroll/copy-link/placement
   fallbacks) stays a separate follow-up ticket; this PR only touches the
   broken-atom + existing overlay.

---

## Sequencing (suggested commits)

1. Rename `noun/typeName` → `itemType/displayName` (+ union type) across component,
   usage, base, host, tests. _(items 2, 6)_
2. Warning icon → raw-icon + `rebuild:icons`. _(item 1)_
3. Overlay × → `ContextButton` + close action. _(item 3b)_
4. CSS radius/token conformance pass. _(item 3a)_
5. Inline broken-preview placement fix + test. _(item 4)_
6. Stable `EMPTY_ERROR_DOC`. _(item 5)_

## Verification

- `pnpm rebuild:icons` clean; new icon renders in Freestyle usage.
- boxel-ui test-app `broken-link-test.gts` + host
  `broken-link-template-test.gts`, `markdown-embed-preview-test.gts`,
  `markdown-embed-preview-pane-test.gts` green.
- `lint:types` clean (union type propagates through all call sites).
- Visual check against `.context/design/broken-card-v2.png` in the Freestyle
  usage page and the chooser preview (host preview build).

## Housekeeping

Delete both `docs/cs-11678-*-plan.md` scratch docs before the PR merges (plan
artifacts don't belong in merged history).
