---
name: gts-component-conventions
description: Styling and authoring conventions for `.gts` components and their CSS in the host and boxel-ui packages, plus the content-tag `<template>`-detection hazards that silently break `.gts` parsing. Use whenever writing, reviewing, or refactoring a `.gts` component, a `<style scoped>` block, or a glimmer template — especially component-styling review passes ("apply these design-review notes", "clean up this component's CSS") and when a `.gts` file mysteriously fails to type-check or lints with phantom unused-import errors. Triggers on editing component markup/CSS, adding SVG icons, writing conditional class names, choosing colors or units, and any cascading "Cannot find name 'template'" or template-was-dropped symptom.
---

# `.gts` Component Conventions

Two things live here:

1. **Design-review guidelines** (from Burcu) for component markup and CSS — apply when writing or reviewing any `.gts` component or `<style scoped>` block.
2. **content-tag `<template>` hazards** — the parser gotchas that silently drop or mangle a template. Read part 2 the moment a `.gts` file fails to type-check or lints with phantom errors after an edit.

Root font-size is the browser default **16px**, so `1rem === 16px`. There is no `html { font-size }` override.

---

## Part 1 — Component & CSS guidelines

### 1. Target DOM elements with `data-*` attributes, not class names

Class names are a styling concern; JS that reaches into the DOM (`closest`, `querySelector`, `matches`, `hasAttribute`) should key off a `data-*` attribute so refactoring CSS classes never breaks behavior. Keep the class for the `<style>` selector **and** add a `data-*` marker for the JS hook.

```ts
// Wrong — JS coupled to a styling class
let marker = el.closest('.adorn-context');

// Right — class stays for CSS; data attribute is the JS contract
let marker = el.closest('[data-adorn-context]');
```

```hbs
<div class='adorn-context' data-adorn-context ...attributes>
```

`data-test-*` attributes (used by the test suite) already follow this — extend the same habit to runtime DOM lookups.

### 2. Use scalable units (`rem`) instead of `px`

Convert dimensional CSS values — `width`/`height`, `padding`, `margin`, `gap`, `border-radius`, `font-size`, `box-shadow` spreads, `clip-path` offsets, positioning insets — to `rem` (divide px by 16). Prefer the existing `--boxel-sp-*`, `--boxel-font-*`, and radius tokens when one fits.

```css
gap: 0.3125rem; /* was 5px */
padding: 0.1875rem 0.4375rem; /* was 3px 7px */
font-size: 0.625rem; /* was 10px */
box-shadow: 0 0 0 0.125rem var(--c); /* was 2px */
```

**Leave as-is:** SVG-internal coordinates (`viewBox`, `cx`, `r`, `stroke-width`, path `d`), and JS pixel math against `getBoundingClientRect()` — those aren't CSS layout units. Hairline values like `letter-spacing: 0.5px` are fine to leave (converting gains nothing).

### 3. Save hardcoded colors as CSS variables

Never ship a raw hex/rgb in a component. If a color recurs across components, promote it to a shared token in `packages/boxel-ui/addon/src/styles/variables.css`; if it's truly local, define a component-scoped custom property. Falling back to another variable is fine (`var(--token, var(--other))`); a hardcoded literal fallback is not.

Reuse an existing semantic token before inventing a new one, and **name tokens by role, not by hue**. A color named for its appearance (`--boxel-teal-ink`, `--boxel-dark-teal`) is a palette primitive; a color named for its job (`--boxel-highlight`, `--boxel-highlight-hover`) is what components should reference.

For "readable text/icons on a colored surface," the codebase uses the pervasive **`<surface>` / `<surface>-foreground` pairing** (shadcn/Tailwind-style): `--foreground`, `--muted-foreground`, `--primary`/`--primary-foreground`, `--accent-foreground`, `--card-foreground`, plus component-local `--boxel-*-foreground`. The idiom is `color: var(--primary-foreground, var(--boxel-dark))`.

**Don't reference numbered palette tokens (`--boxel-100`…`--boxel-500`) directly in component CSS.** They are the primitive layer — fixed values that do not flip between light and dark. The semantic role tokens resolve _through_ them and _are_ themed for both modes. Reach for the role token every time:

| Instead of the numbered palette                 | Use the semantic role token     |
| ----------------------------------------------- | ------------------------------- |
| `--boxel-200` (muted surface / track)           | `--muted`                       |
| `--boxel-450` / `--boxel-500` (secondary text)  | `--muted-foreground`            |
| `--boxel-light` / `--boxel-dark` (base text/bg) | `--foreground` / `--background` |

```css
/* Wrong — primitive palette, doesn't theme */
color: var(--boxel-450);
background-color: var(--boxel-200);
/* Right — semantic role, themed light + dark */
color: var(--muted-foreground);
background-color: var(--muted);
```

For the accent, `--primary` is the top-level role token — it resolves to `--boxel-highlight` (§6) but lines up with the shadcn-style `--primary`/`--primary-foreground` pairing the shared components use, so prefer `--primary` for accent fills in component CSS.

The adorn refactor therefore landed on existing/semantic tokens rather than hue-named ones:

- darker teal for hover/selected → `--boxel-highlight-hover` (resolves through `--boxel-dark-teal: #00da9f`). Don't add a parallel "teal-hover" variable.
- dark foreground on a highlight surface → `--boxel-highlight-foreground: #0a2e1c` (the companion to `--boxel-highlight` / `--boxel-highlight-hover`, following the `-foreground` convention).

```css
/* role-named, not hue-named or hardcoded */
color: var(--boxel-highlight-foreground); /* was #0a2e1c */
background-color: var(--boxel-highlight-hover); /* was #00da9f */
```

### 4. Use the `cn` helper for conditional class names

Don't hand-concatenate classes with inline `{{if}}`/`{{unless}}` inside a class string. Use `cn` from `@cardstack/boxel-ui/helpers` — positional base classes, named boolean classes.

```hbs
{{! Wrong }}
<div class='adorn-label {{if @compact "compact"}} {{unless (has-block "dropdown") "no-menu"}}'>

{{! Right }}
<div class={{cn 'adorn-label' compact=@compact no-menu=(unless (has-block 'dropdown') true)}}>
```

`cn` emits the same space-separated string, so this is behavior-preserving — existing `data-test`/class selectors keep matching.

### 5. SVGs: keep them separate, stroke/fill with `currentColor`

- Factor SVG artwork into dedicated icon **components** (the repo convention — e.g. `selection-checkmark-icon.gts`) or `@cardstack/boxel-icons` / `@cardstack/boxel-ui/icons`, rather than duplicating raw `<svg>` markup. Ship compressed/optimized SVG.
- Make the themeable parts `stroke='currentColor'` / `fill='currentColor'` so a parent can color the icon via `color:`. Parts that are intentionally a fixed brand color (e.g. a dark circle behind a themeable check) reference a token instead of a literal.

```hbs
{{! themeable check follows the parent's color }}
<path d='…' stroke='currentColor' />
{{! fixed dark disc → token, not a hex literal }}
<circle cx='7' cy='7' r='7' fill='var(--boxel-highlight-foreground)' />
```

### 6. Use `--boxel-highlight`, not `--boxel-teal`, for the default highlight

`--boxel-highlight` resolves to `--boxel-teal` today, but it's the app-wide semantic token for the highlight accent. Referencing it keeps highlight color consistent and re-themeable across the app. (Same idea for `--boxel-highlight-hover`.)

```css
/* prefer the semantic token, not the raw palette color */
--adorn-accent-light: var(--boxel-highlight); /* not var(--boxel-teal) */
background-color: var(--boxel-highlight); /* not var(--boxel-teal) */
```

### 7. Don't use the `font` shorthand

The `font` shorthand requires (and therefore resets) `font-family`, so it drops the inherited themed family. Set the axes you actually mean — `font-weight`, `font-size`, `line-height` — and let `font-family` inherit. The bundled `--boxel-font-*` tokens (e.g. `--boxel-font-xs`) are themselves `size/line-height family` shorthands, so feeding them to `font:` is the same trap; use the split `--boxel-font-size-*` + `--boxel-line-height-*` tokens instead. Reserve `font:` for the rare case you deliberately want a non-themed family.

```css
/* Wrong — resets font-family off the themed family */
font: 500 var(--boxel-font-xs);
/* Right — themed family inherited */
font-weight: 500;
font-size: var(--boxel-font-size-xs);
line-height: var(--boxel-line-height-xs);
```

### 8. Reach for an existing boxel-ui component before hand-rolling

Before building a common UI primitive — progress bar, pill, button, avatar, tabs, tooltip, badge — check `@cardstack/boxel-ui/components` for one. The shared components are already themed (they consume `--primary`/`--muted`/etc.) and carry their accessibility markup, so reusing one is both less code and correct-by-default. Hand-roll only when nothing fits, and surface the gap.

```hbs
{{! Wrong — a hand-rolled track + fill div you then have to theme yourself }}
<div class='bar'><div class='fill' style={{this.widthStyle}}></div></div>
{{! Right — the shared, themed component }}
<ProgressBar @value={{this.percent}} @max={{100}} />
```

---

## Part 2 — content-tag `<template>` hazards

`content-tag` (the preprocessor glint and `ember-eslint-parser` use to parse `.gts`) has JavaScript-lexer bugs that make it lose track of `<template>` tags. When that happens the template is silently dropped or misparsed — and the symptom is **not** where the bad character is. AGENTS.md (§ "`.gts` file gotcha") is the canonical list; the known triggers:

**1. Backticks inside a regex literal** — mistaken for template-literal delimiters.

```ts
.replace(/`([^`]+)`/g, '$1')                  // BROKEN
const INLINE_CODE_RE = new RegExp('`([^`]+)`', 'g');  // FIX
```

**2. `!/regex/` (negation before a regex literal)** — the `/` after `!` is misread.

```ts
lines.some((line) => !/^\s*#/.test(line)); // BROKEN
const HEADING_RE = /^\s*#/; // FIX — extract to a const
lines.some((line) => !HEADING_RE.test(line));
```

**3. A backtick-wrapped bracket token inside the _template body_** — e.g. a `<style>` CSS comment.

```hbs
<template>
  <style scoped>
    /* BROKEN: backtick-wrapped `[data-adorn-context]` here drops the template */
    /* FIX: drop the backticks or the brackets in template-region comments */
  </style>
</template>
```

The identical text in a `//` comment _outside_ `<template>…</template>` is harmless — content-tag only runs its template-mode lexer between the tags. So keep backtick-wrapped selectors like `` `[data-foo]` `` out of comments inside the template; describe the marker in a regular JS comment above the component instead.

### Recognizing it

- **Outside-template triggers (1 & 2):** cascading TypeScript errors beginning with `Cannot find name 'template'` at the first `<template>` in the file.
- **Inside-template trigger (3):** the template body is silently dropped, so **type-check may still pass** while ESLint reports phantom `no-unused-vars` on imports/consts that the template references (e.g. `hash`, a yielded const). **ESLint is the canary** here — if a refactor that only touched a `<template>`/`<style>` block suddenly makes prior imports "unused," suspect a swallowed template before you touch the imports.

### Bisecting

Revert to the last-good file and re-apply changes one hunk at a time, running `npx eslint <file>` between each, until the phantom errors reappear. The offending hunk is almost always a comment or string edit inside the `<template>` block, not a code change.
