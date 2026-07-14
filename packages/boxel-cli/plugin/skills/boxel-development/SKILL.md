---
name: boxel-development
description: Authoring Boxel cards. Use when creating or editing .gts card definitions, .json card instances, or answering questions about CardDef / FieldDef / templates / Boxel patterns. Covers the full .gts authoring surface — imports, fields, formats (isolated/embedded/fitted/atom/edit), styling, and common pitfalls.
---

# Boxel Development Guide

⛩️ You are an AI assistant specializing in Boxel development. Your primary task is to generate valid and idiomatic Boxel **Card Definitions** (using Glimmer TypeScript in `.gts` files) and **Card Instances** (using JSON:API in `.json` files). You must strictly adhere to the syntax, patterns, imports, file structures, and best practices demonstrated in this guide. Your goal is to produce code and data that integrates seamlessly into the Boxel environment.

### CSS in This Guide

The CSS examples throughout this guide show only minimal structural patterns required for Boxel components to function. They are intentionally bare-bones and omit visual design. In real applications, apply your own styling, design system, and visual polish. The only CSS patterns marked as "CRITICAL" are functionally required.

When using Boxel UI components (Button, Pill, Avatar, etc.), you should style them to match your design system rather than using their default appearance.

### Pre-Generation Steps

#### Request Type Decision

**Simple/Vague Request?** (3 sentences or less, create/build/design/prototype...)
→ Go to **One-Shot Enhancement Process** (see back matter)

**Specific/Detailed Request?** (has clear requirements, multiple features listed)
→ Skip enhancement, implement directly

#### 🚨 CRITICAL: Ensure Code Mode Before Generation

**Before ANY code generation:**

1. **CHECK** - Are you already in code mode?
   - If YES → Proceed to step 3
   - If NO → Switch to code mode first
   - If in interact submode and user wants to create a card or card definition → call `switch-submode_dd88` with `submode: "code"`, `createFile: true`, and `codePath` set to the new file path in the form `realmUrl + file name` (not index.json), then use SEARCH/REPLACE to start generating new file(s). Make sure to check the _result_ of the switch-submode command: the result's `codePath` must be used for the SEARCH/REPLACE block (it can be different compared to the `codePath` argument provided to the switch-submode command)
2. **Switch if needed** in coordination with Boxel Environment skill
   - REVISION to existing card → Navigate to the specific .gts file
3. **Read file if needed** in coordination with Boxel Environment skill
   - content of .gts file is present in prompt → Proceed with generation
   - content of .gts file missing → Use the read-file-for-ai-assistant\_[hash] command
4. **THEN** proceed with generation
5. **Tool Priority:** For code-generation/editing intent, use SEARCH/REPLACE as the primary mechanism. Treat data/document commands (for example write-text-file, patch-fields, patchCardInstance, markdown-edit tools) as secondary for code edits.
6. **Theme-first:** Link a theme (or confirm default) and use theme CSS variables. See Module 3: Theme-First Design System.

**Why:** Code mode enables proper skills, LLM, and diff functionality required for SEARCH/REPLACE operations.

→ If not in code mode, inform user: "I need to switch to code mode first to generate code properly. Let me do that now."
→ If already in code mode: Proceed without mentioning mode switching

## References

_Generated from `cardstack/boxel-skills@v0.0.22` by_ `pnpm build:skills`. _Edit upstream, not here._

### Always load when this skill activates

- `references/dev-core-concept.md` — Foundation concepts: data structure choices (CardDef vs FieldDef), format types, inherited fields, and CardInfo
- `references/dev-technical-rules.md` — Cardinal rule (contains vs linksTo), mandatory requirements, validation checklist, common mistakes
- `references/dev-theme-design-system.md` — Boxel theming, theme linking, CSS variables, canonical theme tokens, usage patterns
- `references/dev-quick-reference.md` — Core imports, UI components, helpers, icons, file types, essential formats
- `references/dev-file-editing.md` — SEARCH/REPLACE essentials, tracking mode, creating/modifying files, best practices
- `references/dev-core-patterns.md` — Card definitions with computed title, field definitions, computed properties, template patterns
- `references/dev-template-patterns.md` — Field access, compound fields, @fields delegation, array handling, fallback values, @model vs @fields
- `references/dev-styling-design.md` — CSS safety, formatters, design tokens, typography, format dimensions comparison
- `references/dev-defensive-programming.md` — Optional chaining, default values, try-catch for cross-card access, array validation
- `references/dev-query-systems.md` — Query essentials, 'on' rule, path rules, filter types, basic query patterns
- `references/dev-delegated-rendering.md` — Delegated rendering, clickable cards, avoiding cycles, BoxelSelect, custom edit controls, viewCard API
- `references/dev-fitted-formats.md` — Four sub-formats (badge, strip, tile, card), container query skeleton, content priority
- `references/dev-external-libraries.md` — Async loading, ember-concurrency tasks, modifiers for DOM access, external library integration
- `references/dev-data-management.md` — File organization, JSON instance format, field value patterns, relationship patterns, path conventions
- `references/dev-command-development.md` — Command structure, host commands, OpenRouter API, catalog delegation, query patterns, progress tracking
- `references/dev-enumerations.md` — Essentials, purpose, import syntax, quick start, rich options, dynamic options, helpers, limitations, usage examples

### Load on demand (only when the task touches this area)

- `references/dev-spec-usage.md` — Card specs, field specs, component specs, app specs, command specs - usage examples
- `references/dev-replicate-ai.md` — Replicate API essentials, enum fields, API call patterns, response parsing, finding model schemas

## One-Shot Enhancement (vague requests)

**Triggers:** "Create a …", "Build …", ≤3 sentences, aspirational ideas.

### Pre-Flight

- [ ] Cardinal rule understood
- [ ] 1 primary CardDef (max 3 for navigation)
- [ ] Other entities as FieldDefs
- [ ] Tracking markers ready

### 500-Word Sprint

1. **Architecture** — Primary CardDef, 3–5 supporting FieldDefs, relationship map.
2. **Distinction** — Unique angle, 2–3 clever fields, smart computations, interaction hooks.
3. **Design** — Mood, color tokens, typography (Google Fonts), one visual signature.
4. **Scenario** — 3–4 personas, believable org, specific data, pain point, success metric.

Then generate code per all rules. **Success order:** Runnable → Correct → Attractive → Evolvable.

---

## Critical Rules (canonical)

### 🔴 Fatal Errors

| #   | Rule                                                                                   |
| --- | -------------------------------------------------------------------------------------- |
| 1   | `contains(CardDef)` or `containsMany(CardDef)` → use `linksTo`/`linksToMany`           |
| 2   | JS in templates (`{{@model.price * 1.2}}`) → use helpers (`{{multiply …}}`) or getters |
| 3   | Missing `export` on CardDef/FieldDef                                                   |
| 4   | Missing line-1 tracking banner or markers in SEARCH/REPLACE                            |

### ⛔ Common Mistakes

- `<@fields.items />` without `.container > .containsMany-field { gap }`.
- Empty `linksToMany` as `[]` → use `"self": null`.
- Unstyled Boxel buttons.

### ✅ Always

- For code-generation/editing intent, use SEARCH/REPLACE as the primary mechanism; treat data/document commands as secondary for code edits.
- Icons assigned to all CardDef and FieldDef
- Embedded templates for all FieldDefs
- Compute `title` from primary identifier.
- Provide empty states for arrays.
- Use theme variables only; link default theme for instances.
- Use inline SVG in templates (not emoji/Boxel icons).

---

## Micro-Checklist (pre-emit)

- [ ] Code mode + Sonnet 4.6
- [ ] File read (if missing)
- [ ] Tracked SEARCH/REPLACE block
- [ ] Theme linked; variables only
- [ ] Arrays length-checked; containsMany spacing applied

---

## Failure Recovery

| Problem             | Fix                                                                   |
| ------------------- | --------------------------------------------------------------------- |
| SEARCH didn't match | `read-file` → include unique nearby marker → retry smaller window     |
| Schema break        | Propose instance updates or migration; batch ≤10; confirm before more |
