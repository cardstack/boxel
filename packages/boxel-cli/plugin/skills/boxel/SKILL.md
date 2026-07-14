---
name: boxel
description: Use whenever creating, reading, or editing Boxel cards (.gts files), card instances (.json), fields, templates, queries, or anything in a Boxel realm. Required for any Boxel coding work — covers CardDef, FieldDef, contains/linksTo, templates, formats, queries, and core patterns. Companion skills - boxel-design (visual decisions), boxel-ui-guidelines (template UI), source-code-editing (SEARCH/REPLACE), boxel-environment (running the Boxel app).
boxel:
  kind: skill
---

# Boxel Development

You are generating idiomatic Boxel: **Card Definitions** in `.gts` (Glimmer TypeScript) and **Card Instances** in `.json` (JSON:API). Follow the syntax, imports, file layout, and patterns below exactly. Output must compile and run inside a Boxel realm.

---

## 🚨 Cardinal Rules (must be true before emitting any code)

| #   | Fatal error if violated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `contains(CardDef)` or `containsMany(CardDef)` — use `linksTo` / `linksToMany` instead. CardDefs have identity, FieldDefs don't.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2   | JS expressions in templates (e.g. `{{@model.price * 1.2}}`) — use helpers (`{{multiply ...}}`) or move to a getter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3   | Missing `export` on a CardDef or FieldDef. Nothing imports unexported classes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 4   | Missing line-1 tracking banner or `ⁿ` markers when edit-tracking mode is on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 5   | Missing `fitted` format on a CardDef. All CardDefs need `isolated`, `embedded`, AND `fitted`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 6   | **Query: `filter: { on: ref }` with no predicate. To match all cards of a type, use `filter: { type: ref }`.** `on` is a _scope_ for predicates (`eq`/`contains`/`range`), not a filter itself. A bare `{ on: ref }` returns zero rows silently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | **Query sort: custom field without `on: ref`.** Only `lastModified`, `createdAt`, `cardURL` work as sort keys without `on`. Sorting on `lastName`, `dates.start`, anything custom — sort expression MUST include `on: ref` or the query is rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8   | **Query refs: hand-rolled URL or `Symbol.for('realmURL')`.** Use `codeRef(here, path, name)` and import `realmURL` (a Symbol) from `@cardstack/runtime-common`. `Symbol.for('realmURL')` produces a _different_ Symbol that doesn't match what the host injected → `realms: []` → query never fires.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 9   | **Template helper/modifier import mismatch.** In `.gts`, `fn`, `on`, `concat`, `get`, `array`, `hash`, Boxel UI predicates, and formatters must be imported explicitly. Do **not** use `(perform ...)` in strict-mode templates and do **not** import `ember-concurrency/helpers/perform`. Trigger tasks through a scoped handler like `startSave = () => this.saveTask.perform();` and bind `{{on 'click' this.startSave}}`. Run the import preflight in `references/common-imports.md` before finalizing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 10  | **Missing Boxel CLI lint.** Every `.gts` code change must run the installed npm `@cardstack/boxel-cli` lint gate before being called done. `npx boxel check` is sync-state only and never satisfies lint. Clean means `No lint issues found` or JSON with an empty `messages` array. See `references/lint-workflow.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 11  | **Inline media/binary in card JSON.** Never persist `data:`, `blob:`, base64, ArrayBuffer text, MP3/image bytes, or generated media payloads in `StringField`, `TextAreaField`, `outputText`, JSON attributes, or `Base64ImageField`. Media assets must be stored as realm files (`linksTo(FileDef/ImageDef/PngDef/etc.)`). For generated bytes, use `WriteBinaryFileCommand` first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 12  | **`DateField` vs `DateTimeField` — schema MUST match value format.** `contains(DateField)` requires JSON value `YYYY-MM-DD` (NO `T`). `contains(DateTimeField)` requires ISO datetime with `T` (`YYYY-MM-DDTHH:MM:SS[.sss]Z`). A mismatch passes `npx boxel file lint`, writes successfully, AND indexes — then blows up at render time as `RangeError: Invalid time value` from date-fns inside `Contains.serialize`. Pick the type by whether time-of-day is meaningful (`*At` suffix → DateTimeField; `*Date`/`*On`/`hireDate`/`dob` → DateField), then keep instance values in lockstep. See `references/base-field-catalog.md`.                                                                                                                                                                                                                                                                                                                                                 |
| 13  | **🚨 External URLs in JSON:API `relationships.<field>.links.self` brick the entire realm.** A relationship's `links.self` is a card identifier — relative paths (`"../Theme/foo"`) or absolute realm URLs only. **NEVER put an external image/asset URL there.** The indexer fetches the URL expecting a card document, gets binary bytes (JPEG, PNG, etc.), `JSON.parse` throws on the binary, the error message contains the binary's NULL byte, postgres rejects the JSONB write with `22P05: unsupported Unicode escape sequence`, and the transaction rolls back — taking every other card in the batch with it. The whole realm stays unindexed until the bad instance is fixed. For image URLs, use the `cardInfo` pair pattern: `@field heroImage = linksTo(ImageDef)` + `@field heroImageURL = contains(UrlField)`; the URL goes in `attributes.heroImageURL`, not the relationship. See `references/base-field-catalog.md` "Image fields — the URL/ImageDef pair pattern". |
| 14  | **🚨 `linksToMany` JSON shape uses INDEXED KEYS, never an array under `links.self`.** Each linked item in a `linksToMany` field gets its own top-level relationship key with an indexed suffix. Correct: `"activityFeed.0": { "links": { "self": "..." } }`, `"activityFeed.1": { "links": { "self": "..." } }`. WRONG (and the host rejects with "instance ... is not a card resource document"): `"activityFeed": { "links": { "self": ["...", "..."] } }`. The array-inside-`self` shape is intuitive but not valid Boxel JSON:API — `links.self` is a single string per JSON:API spec, and Boxel's encoding of "many" is indexed top-level keys. See `references/core-patterns.md` "JSON:API instance shapes".                                                                                                                                                                                                                                                                   |

> **Rules 6–8 are the silent-zero-rows traps.** No error is thrown; the response is just empty, every time. Memorize them before writing any query. Full reference: [`references/query-systems.md`](references/query-systems.md).
>
> **Rule 12 is the silent-renders-then-crashes trap.** The mismatch survives every static check; only the runtime card render reveals it. Cross-check schema declarations against instance values before declaring a card family done.

## 🧠 Decision Trees

**Data shape**

```
Needs own identity / referenced from multiple places? → CardDef + linksTo
Image / document / file asset?                       → FileDef subtype + linksTo (see boxel-file-def)
Generated/uploaded media payload?                    → Write bytes with WriteBinaryFileCommand, then linksTo FileDef/ImageDef/PngDef. Never StringField data URI.
Compound data only AND list of ~1–3 items?           → FieldDef + containsMany
Compound data, list grows past 3 items?              → CardDef + linksToMany (perf — see below)
Compound data, exactly one item?                     → FieldDef + contains
```

⚠️ **The `containsMany` edit-form perf trap.** The host's default edit template renders an inline editor for every field on every contained item. A FieldDef with 6 fields × 5 items = 30 inline editor components in the parent's edit form. Each keystroke re-renders all of them, producing ~1s/keystroke at this scale (measured against Swimmer + PersonalBest, 5/21/26).

Concrete rule: if a containsMany list will routinely hold **3 or more entries** AND each entry has **3 or more fields**, lift the FieldDef to a CardDef and use `linksToMany`. The editor becomes a card picker (lightweight rows) instead of N inline forms. Each linked card is edited on its own page with its own dedicated edit form.

Acceptable `containsMany`: tags (`containsMany(StringField)`), 1–2 phone numbers, a couple of social links. Unacceptable: race results, line items, addresses-with-7-fields, anything where a user will accumulate ≥3 entries with multiple fields each.

**Field extension**

```
Customizing a base field?     → import BaseField, extend it
Brand-new field type?         → extends FieldDef
Tweaking an existing field?   → extends BaseFieldName
```

**Request handling**

```
Simple/vague request (≤3 sentences, "build a X") → run the 500-Word Sprint below before emitting code
Specific/detailed request                        → skip the sprint, implement directly
```

## ⚡ 500-Word Sprint (for vague requests)

1. **Architecture** — 1 primary CardDef (max 3 for navigation), 3–5 supporting FieldDefs, relationship map.
2. **Distinction** — Unique angle, 2–3 clever fields, smart computations, interaction hooks.
3. **Design** — Mood, theme tokens, typography, one visual signature. (Consult `boxel-design`.)
4. **Scenario** — 3–4 personas, believable org, specific data, pain point, success metric.

Then emit code. Success order: **Runnable → Correct → Attractive → Evolvable.**

---

## 📚 References (read on demand)

Read a reference when its topic comes up — and batch: when several references apply to the task at hand (a new card build usually implicates a handful from this list), read them all in one multi-file read rather than one or two at a time. Every extra round of reads delays your first line of output.

Core syntax and patterns (load when topic comes up):

- `references/core-concept.md` — CardDef vs FieldDef, formats, inherited fields, CardInfo.
- `references/technical-rules.md` — Cardinal rule details, mandatory requirements, validation checklist.
- `references/quick-reference.md` — Core imports, UI components, helpers, icons, file types.
- `references/common-imports.md` — Common `.gts` imports and the import preflight for `fn`, task handlers, `on`, `concat`, `get`, helpers, formatters, tasks, and host commands. Load before generating or reviewing non-trivial templates.
- `references/lint-workflow.md` — Mandatory installed npm `boxel` lint commands, local vs remote lint, clean-output interpretation, and fallback rules.
- `references/core-patterns.md` — Card definitions, computed title, field definitions, computed properties.
- `references/prefers-wide-format.md` — When `static prefersWideFormat = true` is required (app-card homes, sectioned-record nav, 3D layouts, routed pages, dashboards, slide decks). Default is `false`; the most-forgotten static property. **Decide at CardDef creation time, not after the layout looks cramped.**
- `references/template-syntax.md` — Field access, compound fields, `@fields` delegation, array handling, fallback values, and Glimmer syntax gotchas (the `{{#if (this.x)}}` parens trap, HTML-tag-shadowing block params).
- `references/file-editing.md` — Edit tracking mode, SEARCH/REPLACE essentials, creating vs modifying files.
- `references/data-management.md` — File organization, JSON instance format, field value patterns, relationships.
- `references/card-references.md` — `links.self` shapes: relative (`./Foo/bar` / `../Foo/bar`) vs absolute vs registered-prefix; FileDef-typed relationships need the file extension; `$REALM` and `@cardstack/...` rules; common silent-failure modes.
- `references/defensive-programming.md` — Optional chaining, default values, try/catch, array validation.
- `references/defensive-link-traversal.md` — Reading `linksTo`/`linksToMany` is not like `contains`: a linked slot reads `undefined` while loading and forever if broken. The per-slot contract, `linksToMany` `undefined` holes (`arr.length` unchanged), `.filter(Boolean)` before count/render, and `getRelationship`/`RelationshipState` for distinguishing loading vs broken.
- `references/relationship-loading-state.md` — `getRelationshipMembershipState(this, 'field').isLoading`: a live, tracked per-field boolean for driving a spinner (flagship: query-backed `linksToMany`). Observe-only — the template must also read the field or the load never starts.

Subsystems (load when used):

- `references/query-systems.md` — Query syntax, the `on` rule, filter types, and the display surfaces: `@context.searchResultsComponent` (entry-rooted, preferred), `PrerenderedCardSearch`, and `getCards`.
- `references/searchable-fields.md` — The `searchable` field option (`true | string | string[]`) controlling which `linksTo`/`linksToMany` targets are pulled into the search doc (contained always in; links opt-in); dotted-path routing; the query-time error for querying a non-searchable path.
- `references/fitted-formats.md` — Four sub-formats (badge/strip/tile/card), size classification. Quick reference only.
- **`references/design-playbook.md`** — **The recommended way to design any user-facing card.** Four-stage process: (1) mockup with no variables, (2) extract theme DNA, (3) tokenize, (4) derive fitted/embedded. Includes the verbatim design-challenge framing (Pentagram art director + internal taste-maker) and the "fitted features the media" rule. Trust your intrinsic design taste; this is a process, not a CSS rulebook.
- `references/container-query-fitted-layout.md` — Mandatory implementation standard for every `fitted` template: two-element `.cq` → `.fit` structure, container-query sub-formats, `pow()` typography variables, `minmax(0, 1fr)` body rows, and `min-height: 0` overflow discipline. Derive the visual layout from the design playbook first, then implement fitted with this guide.
- `references/delegated-rendering.md` — Card-to-card rendering, clickable cards, BoxelSelect, custom edit controls.
- `references/command-development.md` — Command structure, host commands, OpenRouter, generated binary file persistence, progress.
- `references/command-invocation-modes.md` — Taxonomy of how to expose a Command: direct call, reactive resource, card menu item, typed run card, AI processor, CLI script, atomic install. The same Command class served multiple ways.
- `references/theme-design-system.md` — Theme linking, CSS variables, canonical tokens.
- `references/styling-design.md` — CSS safety, formatters, design tokens, typography, format dimensions.
- `references/formatters.md` — Canonical `@cardstack/boxel-ui/helpers` formatter list (`formatDateTime`, `formatNumber`, `formatCurrency`, duration, file size, lists, names, ordinals, periods, age) and display-boundary guidance.
- `references/external-libraries.md` — Async loading, ember-concurrency, DOM modifiers, third-party libs.
- `references/enumerations.md` — `enumField` for constrained-value dropdowns, rich/dynamic options, helpers. Includes label-rendering pattern (const-map + `get` helper).
- `references/date-math.md` — Date arithmetic idioms inside `computeVia` vs Component getters, `formatDateTime` boundary, streak/overdue patterns.
- `references/base-field-catalog.md` — Every importable base field (`AddressField`, `DateRangeField`, `PercentageField`, `CodeRefField`, `ColorField`, `EmailField`, `PhoneNumberField`, `CoordinateField`, etc.) — reach past `StringField` when the value has a known shape.
- `references/icons.md` — `@cardstack/boxel-icons` naming convention (Lucide-style descriptor-first like `square-check` not `check-square`), common-use icon table, how to verify before importing.

Specialty (load only when explicitly needed):

- `references/spec-usage.md` — Card/Field/Component/App/Command Specs.

Sibling skills:

- `boxel-design` — visual / design language decisions (colors, typography, mood).
- `boxel-theme-development` — creating, converting, auditing, or patching Theme, StyleReference, DetailedStyleReference, BrandGuide, and DESIGN.md artifacts.
- `boxel-ui-guidelines` — applying theme tokens, using boxel-ui components in templates.
- `boxel-file-def` — file-typed fields (FileDef, ImageDef, MarkdownDef).
- `boxel-flavored-markdown` — BFM content authoring.
- `boxel-markdown-format` — static `markdown` template format.
- `source-code-editing` — SEARCH/REPLACE block format (always consult before editing).
- `boxel-environment` — running, navigating, and orchestrating the live Boxel app.

---

## ⚠️ Common Mistakes

- `<@fields.items />` without `.container > .containsMany-field { gap }` → items collapse together.
- Empty `linksToMany` written as `[]` in JSON → use `"self": null`.
- Unstyled `<Button />` → always style boxel-ui components to your theme.
- Emoji or Boxel icons in templates → use inline SVG.
- Self-import → import a sibling, not yourself.
- Helper import mistakes in GTS templates, especially missing imports for `(fn ...)`, `{{on ...}}`, `concat`, `get`, `array`, `hash`, formatters, and predicate helpers, the invalid `ember-concurrency/helpers/perform` import, or use of `(perform ...)` in strict-mode templates. See `references/common-imports.md`.
- Unused or duplicated imports → lint error (`@typescript-eslint/no-unused-vars`). Import each helper once, from one source, and only if the template actually uses it. Don't import a predicate (`eq`, `gt`, `not`, `and`) from both `@ember/helper` and `@cardstack/boxel-ui/helpers`.
- Concatenated `style='foo: {{this.x}}'` → lint error (`no-inline-styles` + `style-concatenation`). Use an `htmlSafe` getter or the `cssVar` helper; never fall back to fixed-width CSS classes. See `references/styling-design.md` "Dynamic inline styles".
- `<input>` / `<textarea>` / `<select>` without a label → lint error (`require-input-label`). Add an `aria-label` (or associate a `<label for>`).
- AI/image APIs returning `data:image/...;base64` → strip the prefix, write bytes with `WriteBinaryFileCommand`, and store `linksTo(ImageDef/PngDef/FileDef)`; never save the data URI in `outputImageUrl`, `outputText`, notes, JSON, or any string field.

## ✅ Always

- For code-generation/editing, use **SEARCH/REPLACE** as the primary mechanism (see `source-code-editing`).
- Run the import preflight from `references/common-imports.md` AND the lint gate from `references/lint-workflow.md` before reporting a `.gts` file as done.
- Assign an icon to every CardDef and FieldDef.
- Provide an `embedded` template for every FieldDef.
- Compute `title` from the primary identifier field.
- Provide empty states for arrays.
- Use theme variables only; link a default theme on instances.
- Store media as linked FileDef/ImageDef/PngDef; only small durable `http(s)` URLs belong in string fields.

## 🔁 Failure Recovery

| Problem                            | Fix                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| SEARCH didn't match                | Re-read the file, include a unique nearby marker, retry with a smaller window. |
| Schema break on existing instances | Propose instance updates or a migration; batch ≤10; confirm before continuing. |
