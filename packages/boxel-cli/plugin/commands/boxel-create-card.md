---
name: boxel-create-card
description: Create a new CardDef, FieldDef, or small card family with all required formats.
boxel:
  kind: skill
---

# /boxel-create-card

## Use When

- The user wants a new CardDef, FieldDef, or small card family.
- They describe a domain ("a recipe card", "a project tracker", "a quote document") without yet having code.

## Inputs

- Realm URL or local realm path.
- The card concept (one sentence is fine).
- Whether sample JSON instances are needed.

## Read (REQUIRED, in order)

1. **`skills/boxel/references/design-playbook.md`** — THE process. Four stages: mockup → extract → tokenize → derive. The verbatim Pentagram-art-director framing IS stage 1. Read this in full before any other skill.
2. **`skills/boxel-ui-guidelines/references/delegated-render-control.md`** — REQUIRED if this card embeds other cards via `<@fields.X @format='...' />`. Covers: format choice (fitted vs embedded — _upstream_ of any CSS; pick the wrong one and you get empty boxes), the plural-field wrapper trap (`linksToMany` ≠ `containsMany` in class names), atom-on-dark-background invisibility, stagger via CSS-variable cascade through `display: contents`, and the per-format chrome contract.
3. **`skills/boxel-patterns/patterns/app-card-home-with-search/README.md`** — REQUIRED if this build is a card _family_ (2+ related CardDefs). Build a Home CardDef alongside them so the realm has an entry point.
4. `skills/boxel-patterns/patterns/cardinfo-override-title/README.md` — the `cardTitle` override that respects user input.
5. `skills/boxel/SKILL.md` (focus on `references/core-concept.md` — CardInfo + computed pass-throughs).
6. `skills/boxel/references/base-field-catalog.md` — reach past `StringField` when the value has a known shape (`EmailField`, `DateRangeField`, `PercentageField`, etc.).
7. `skills/boxel/references/icons.md` — verify icons against the CDN HEAD before importing.
8. `skills/boxel/references/lint-workflow.md` — mandatory installed npm `boxel` lint gate.
9. `skills/source-code-editing/SKILL.md`.
10. Check `skills/boxel-patterns/SKILL.md` for a ready pattern matching the outcome (`automate-linked-to-me-lookup`, `format-morph-shared-component`, `polymorphic-field-subclass`, `resource-for-state`).

## Procedure — apply the design playbook

The playbook is mandatory for any user-facing card. Skip only for utility cards (lookup tables, internal config). For **card families** (2+ related CardDefs), stage 0 below is REQUIRED before any real schema is written — without it, fitted views end up pedestrian because the data model isn't rich enough to compose with.

### Stage 0 — Planning artifacts (for card families)

Produce these BEFORE writing any production CardDef. Each can ship as a CardDef whose `static isolated` IS the plan document, pushed to the realm so the user can review visually. See `boxel/references/design-playbook.md` for ASCII templates of each artifact.

| Artifact      | What it answers                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal          | What the family does in one paragraph                                                                                                                                              |
| Brief         | What makes this unique + important for users                                                                                                                                       |
| DataModelPlan | ASCII data-flow diagram + schema sketch (CardDef list, FieldDef list, relationships, sensitive vs operational realm split)                                                         |
| Sample data   | 3-5 dossiers per CardDef — real names, real prices, real photo captions                                                                                                            |
| ASCII layout  | Box layout for each CardDef's `isolated` view — where the hero image goes, where the eyebrow vs headline vs meta lives                                                             |
| MicroMockups  | Hi-fi mockup of each format (`isolated` / `embedded` / `fitted` / `edit`) at desktop AND mobile, with the divider strategy decided. All cards responsive in `isolated` AND `edit`. |

The source pattern is in `app.boxel.ai/.../actual-duck-82/{architecture-plan,data-model-plan,micro-mockups}.gts` — three CardDefs whose isolated templates ARE the plan documents. Without stage 0, agents reach for thin schemas (name + description + date) and produce fitted views with nothing to show. Stage 0 forces the rich-enough data model and the signature-field decision (which field is the visual hero of fitted: the photo? the price? the badge?).

### Stage 1 — Mockup pass (NO variables)

Write `static isolated` as an HTML/CSS mockup with hardcoded values: real fonts, real `#hex`, real px sizes. The verbatim brief:

> Do a design exploration and generate only the above-the-fold view in isolated, framed as such. Write sample content for this use case and fit the elements in there as a design challenge executed by a brand-focused art director of Pentagram, judged by the preeminent taste maker in that field. (Specify who in your thinking, not your final summary.)

Hold an internal taste-maker in mind. Schema must be rich enough that the design has something to compose with — add fields (`subtitle`, `eyebrow`, `cuisine`, `keyIngredient`, `rating`, `reviews`, etc.) the design demands.

Apply intrinsic design taste: serif/sans pairing, weight rhythm (large light + tiny bold), letter-spaced micro-labels, ONE accent color in ≤2 places, editorial micro-objects (avatar with initial, drawn rule, eyebrow + section heading, rule-bracketed data slab). Write evocative sample content in the publication's voice (NYT, Cherry Bombe, Apartamento, Pitchfork — pick the register).

### Stage 2 — Extract theme

Scan stage-1 CSS and pull every distinct decision into named tokens. Write a Theme card whose `cssVariables` ARE the design's palette. Rule of two: tokenize if used twice+; leave inline if used once. Don't add tokens the mockup didn't earn.

### Stage 3 — Tokenize isolated

Replace hardcoded values with `var(--*)` references to the new theme. Pixel-identical to stage 1. Link `cardInfo.theme` on the instance.

### Stage 4 — Derive fitted + embedded

Use the established visual identity to author `static embedded` and `static fitted`. **Fitted MUST feature the card's media** (hero image, illustration, brand mark) if any. Same fonts, same accents, less content.

### When embedding child cards (linksTo/linksToMany)

If any format renders `<@fields.X @format='...' />`, read `delegated-render-control.md` BEFORE writing the parent's CSS. The host injects CardContainer chrome (rounded corners, halo, padding, `overflow: hidden`). The parent overrides via:

- Theme cascade (cleanest — when the child has its own `cardInfo.theme`)
- `:deep(.boxel-card-container)` from the parent's scoped CSS (workhorse)
- `@displayContainer={{false}}` (kills chrome entirely; pair with parent-owned chip span)

For atoms in prose or in a bill list, the canonical pattern is `<@fields.X @format='atom' @displayContainer={{false}} />` inside a parent-owned `<span class='chip'>` so the parent controls borders, alignment, padding.

### Other procedure steps

- Inspect the realm to see existing conventions.
- Decide CardDef vs FieldDef and the relationship type (`contains` vs `linksTo`).
- **Override `cardTitle`** if the card has a natural primary identifier field. Use the canonical form (cardInfo.name → primary field → `Untitled <DisplayName>`). Also override `cardDescription` if you can compute it from other fields.
- Assign a `static icon` on every CardDef and FieldDef (CDN-verified name).

### Sample instances

Create one or two `.json` instances when requested:

- Link the Theme via `"cardInfo.theme": { "links": { "self": "../Theme/<name>" } }` (relationship key has a literal dot).
- Include an explicit `attributes.cardInfo` object with `notes`, `name`, `summary`, `cardThumbnailURL` whenever a theme is linked.
- For nested app folders, prefer an absolute Theme URL in `cardInfo.theme.links.self` unless the relative path has been verified in the live app.
- **Theme JSON itself**: include `attributes.cardInfo` but OMIT `relationships["cardInfo.theme"]` entirely (no self-loop).
- Use `"self": null` for empty `linksTo`/`linksToMany`, NEVER `[]`.
- Include `meta.adoptsFrom.module` + `name`.
- Content should match the design's editorial voice — evocative and real-sounding, never Lorem ipsum.

### Lint/compile verification

- `npx boxel check <file>` is sync state only, NOT a compile or lint check.
- Use the installed npm `@cardstack/boxel-cli` 0.2.0+ lint surface:
  - Before push: `npx boxel file lint <realm-relative-path> --realm <realm-url> --file <absolute-local-file>`.
  - After push: `npx boxel lint <realm-relative-path> --realm <realm-url>`.
- Clean lint means `No lint issues found` or JSON `messages: []`; `ok: true` with lint messages is not clean.
- Run server-side render validation after push too: hit `/_search-prerendered` for `embedded`/`fitted`/`atom`/`head` formats, and open the card in the live app to exercise `isolated`.

### Final gate — verify via search, not via lint

**Lint passing ≠ kit shipped.** Lint is a smoke test of file structure; it does NOT exercise the realm's actual module-load path. A kit can lint clean with 0 of N instances actually indexed.

For every CardDef built in this command, run BOTH gates before declaring done:

```sh
REALM="<realm-url>"

# Gate A: module-load probe (the realm-server actually evaluates the .gts)
npx boxel run-command @cardstack/boxel-host/tools/get-card-type-schema/default \
  --realm "$REALM" \
  --input "{\"codeRef\":{\"module\":\"${REALM}<path>\",\"name\":\"<ClassName>\"}}" \
  --json
# Must return: status: "ready"
# `cardOrThunk was undefined` → bad import or unresolved cycle somewhere in the chain.

# Gate B: typed-search count (instances are recognized as the type)
npx boxel search --realm "$REALM" \
  --query "{\"filter\":{\"type\":{\"module\":\"${REALM}<path>\",\"name\":\"<ClassName>\"}}}" \
  --json
# Count must equal the number of <ClassName> instances you intended to push.
# Use absolute module URLs in --query; relative paths like ./<path> don't resolve from the CLI.
```

If Gate A returns error OR Gate B count is short, the kit is NOT shipped. Do NOT report done.

### Icon — CDN-verify before assignment

Workspace source-file grep is NOT proof. Probe every icon you plan to use:

```sh
for icon in <candidate-1> <candidate-2> <candidate-3>; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/${icon}.js")
  printf "  %-20s HTTP %s\n" "$icon" "$code"
done
```

Require 200 before adding `static icon = X`. See `boxel/references/icons.md` "CDN verification is the only proof an icon exists."

## Done Criteria (self-verify)

**Design playbook (the spine):**

- [ ] Stage 1 mockup was a real designed surface — internal taste-maker held in mind, schema rich enough to compose with, evocative sample content, two-family typography pairing, weight rhythm (large light + tiny bold), letter-spaced eyebrow, ONE accent in ≤2 places, 2-3 editorial micro-objects.
- [ ] Stage 2 theme was EXTRACTED from the mockup (rule of two — tokenize if used twice+), not picked from a generic shadcn palette before the design existed.
- [ ] Stage 3 isolated is pixel-identical to stage 1 but uses `var(--*)` for every value that appears twice+.
- [ ] Stage 4 fitted **features the card's media** if the card has any (hero image, illustration, brand mark, color swatch). Fitted is not a text-only metadata strip when imagery is available.
- [ ] Fitted view **renders correctly at ALL 16 named sizes** (Small/Medium/Large Badge; Single/Double/Triple Strip; Double-Wide/Triple-Wide Strip; Small/Regular/CardsGrid/Tall/Large Tile; Compact/Full/Expanded Card). No content overflow, no clipped text, type hierarchy legible at every cell, sub-format routing (badge/strip/tile/card) hits correctly. Walk the table in `boxel/references/fitted-formats.md` and confirm each row. Verify via the live app's fitted preview — not by `npx boxel check`.

**Chrome contract (every format):**

- [ ] No format's outermost element decorates with `border-radius`, `border`, `box-shadow`, opaque `background`, or `overflow` — those belong to the host's CardContainer or the parent's `:deep()` override. Brand outer-treatment goes on the Theme card via `--radius` / `--background` / `--border`.
- [ ] `fitted` outermost doesn't set `width`, `height`, `min/max-height`, `container-type`, or `container-name` — the host's `.field-component-card.fitted-format` sets those.
- [ ] If this card embeds children via `<@fields.X @format='...' />`, the parent's CSS overrides CardContainer chrome (via `:deep()`, theme cascade, or `@displayContainer={{false}}`) so embedded children look native to the parent's design language — no orphan rounded corners, no misaligned atoms.

**Embedding contract (every place `<@fields.X @format='...' />` appears):**

- [ ] Format chosen by who owns the cell size — `embedded` for natural-height lists/feeds (clubs, events, results), `fitted` for uniform tile grids (portraits, calendar cells). Never `fitted` into a flex column with short content — that produces empty box space below each row. See "Picking the format" in `delegated-render-control.md`.
- [ ] Plural-field grid selectors target `:deep(> .plural-field)` AND `:deep(.linksToMany-itemContainer), :deep(.containsMany-item)` with `display: contents`. Targeting only `.containsMany-field` silently skips `linksToMany` and the grid collapses to one column.
- [ ] Atoms inside dark surfaces use `@displayContainer={{false}}` (or the parent recolors `:deep(.field-component-card.atom-format)` chrome). Default atom chrome has near-white background and will hide light-on-dark text.
- [ ] Staggered animations on plural-field cards use the CSS-variable cascade (`--stagger-d` on the wrapper's `:nth-child(N)`, `animation-delay: var(--stagger-d)` on the card). Direct `:nth-child` on `.field-component-card` always matches `:nth-child(1)` because of the per-item wrapper.
- [ ] Divider strategy chosen explicitly. If the parent draws lines between cards (`border-bottom`, `border-right`, outer-frame borders), the parent ALSO sets `:deep(.boxel-card-container--boundaries) { box-shadow: none; }`. If the child halo IS the boundary, the parent uses `gap` and no parent borders. Mixing produces the "double rule" / "drop shadow fighting border" bug.
- [ ] No duplicate `:deep(.boxel-card-container--boundaries)` rules per section. When switching strategies, DELETE the stale rule — don't just add an override below it. `grep -c "boundaries" <file>` should equal one rule per styled section.

**Home app (mandatory for card families):**

- [ ] If this build introduces 2+ related CardDefs, a `Home` CardDef exists alongside them with `prefersWideFormat = true` and one `@context.searchResultsComponent` section per CardDef. The realm has a clear entry point — no manual indexing. See `app-card-home-with-search`.

**`prefersWideFormat` decision (most-forgotten static property):**

- [ ] For each new CardDef, decided **at creation time** whether `static prefersWideFormat = true` is right. Set true for app-card homes, long-record cards with side nav, dashboards, document / multi-column cards, 3D/spatial layouts, routed pages, spreadsheets, slide decks. Leave false for detail / form / note / settings cards. **Don't defer — discovering you needed it later means rewriting the layout you already wrote against the narrow column.** See `boxel/references/prefers-wide-format.md`.

**Framework rules:**

- [ ] `@field cardTitle` is overridden to compute from a primary field (when one exists) AND respects `cardInfo?.name?.trim()?.length` first.
- [ ] `grep -E '@field [a-z]+ = contains\(CardDef' <file>` returns nothing (no `contains(CardDef)`).
- [ ] `grep -E 'static (isolated|embedded|fitted) =' <file>` returns 3 hits per CardDef.
- [ ] Every exported class is preceded by `export class`.
- [ ] Edit-tracking banner is on line 1 if the file uses tracking mode.
- [ ] Icons imported are CDN-verified (HEAD 200 against `https://boxel-icons.boxel.ai/@cardstack/boxel-icons/v1/icons/<name>.js`).
- [ ] No `{{#if (this.x)}}` parens around bare property access in templates (parens turn it into a helper invocation; class getters fail silently).
- [ ] Entrance animations have their `from` state INSIDE the keyframe and use `animation-fill-mode: both` — never `opacity: 0` in base CSS + `animation: ... forwards`. Otherwise the card goes invisible after a format flip (`isolated → edit → isolated`) or any animation cancellation. See `boxel-ui-guidelines/references/template-patterns.md` → "Entrance animations".
- [ ] Queries use `filter: { type: ref }` to select all of a type (NOT `filter: { on: ref }` — `on` is a scope, not a filter). Custom-field sorts include `on: ref` (only `lastModified`, `createdAt`, `cardURL` work without it). Refs built with `codeRef(here, path, name)` from `@cardstack/runtime-common`; `realmURL` imported as a Symbol from the same module (not `Symbol.for('realmURL')`). See `boxel/references/query-systems.md`.
- [ ] `containsMany(FieldDef)` is used ONLY when the list stays small (≤2 entries typical) OR each entry has very few fields (≤2). For multi-field entries that accumulate (results, line items, history rows, etc.), use `linksToMany(CardDef)` instead — otherwise the edit form gets one inline editor per (entry × field), producing ~1s/keystroke at 5 entries × 6 fields. See boxel/SKILL.md "containsMany edit-form perf trap."

**Instances:**

- [ ] A Theme card exists and is linked from every non-Theme sample instance (`cardInfo.theme` with the dotted key).
- [ ] Sample JSON instances include `attributes.cardInfo` with `notes`, `name`, `summary`, `cardThumbnailURL` when a theme is linked.
- [ ] Theme JSON itself does NOT include `relationships["cardInfo.theme"]` (no self-loop).
- [ ] `meta.adoptsFrom.module` + `name` present on every instance.
- [ ] Sample content matches the design's editorial voice — evocative, real-sounding, never Lorem ipsum.

**Validation:**

- [ ] Local lint was clean before push: `npx boxel file lint <path> --realm <realm-url> --file <local-file>`.
- [ ] Remote lint was clean after push: `npx boxel lint <path> --realm <realm-url>`.
- [ ] A real server-side render check was run (`_search-prerendered` for `embedded`/`fitted`/`atom`/`head` + open in app for `isolated`). `npx boxel check` alone does not satisfy this.

## Failure Recovery

- SEARCH/REPLACE didn't match: read the file again, include a unique nearby marker, retry with a smaller window.
- Card renders as "Untitled <Class>" → you skipped the `cardTitle` override. Add it per `cardinfo-override-title`.
- Card looks unstyled in preview → the instance is missing `cardInfo.theme` link, OR the Theme card itself has empty `cssVariables`. Verify both.
- "instanceof check fails after import" → the constructor was passed unboxed through `{{...}}`. Box it (see pattern `organize-resource-class-data-loader`).
