## Checklist

Before finalizing any card template, verify:

- [ ] No raw `<button>` — use `<Button>` component
- [ ] No raw `<input>` — use `<Input>` or `<FieldContainer>` + `<Input>`
- [ ] No raw `<select>` — use `<Select>` or `<MultiSelect>`
- [ ] No hard-coded colors — use CSS custom properties
- [ ] Semantic theme variables (`--background`, `--foreground`, `--primary`, etc.) used where applicable
- [ ] Scoped styles use `<style scoped>` in templates
- [ ] No `@import url(...)` inside `<style scoped>` — font imports belong in the Theme card's `cssImports` field
- [ ] Semi-transparent colors use `color-mix(in oklch, ...)` not `rgba()`
- [ ] No fixed widths that ignore available space — use relative units or `max-width`
- [ ] Responsive layout uses `@container` queries, not `@media` viewport queries or `vw`/`vh` units
- [ ] Icons and SVGs never use hardcoded hex fills — use theme color tokens via CSS
- [ ] No hardcoded fallback values scattered in `var()` calls — if fallbacks are needed, define them once on the parent container. Falling back to another CSS variable is fine: `var(--token, var(--other-token))`
- [ ] Prefers `<@fields.field />` for all simple field rendering; `@model.x` for conditionals, HTML attributes, context-specific fallback value, and JS getters
- [ ] Custom HTML/CSS replaced with existing boxel-ui components wherever possible
- [ ] Kanban/status boards use `KanbanPlane` and persisted placements; no hand-rolled pointer drag in card templates
- [ ] Any new reusable component has a typed `Signature`, uses design tokens, and is noted with a TODO to contribute to `@cardstack/boxel-ui/components`
