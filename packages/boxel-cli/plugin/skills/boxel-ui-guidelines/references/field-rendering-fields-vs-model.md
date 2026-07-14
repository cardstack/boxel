## Field Rendering: @fields vs @model

Prefer the `@fields` API `<@fields.fieldName />` over `@model` to let the field's own template handle display.

If the fallback should be consistent everywhere the field appears, define it once via a computed field or use `<@fields.fieldName />`.

Reach for `@model.fieldName` when you need the raw value:
- `{{#if @model.x}}` — conditional check
- HTML attributes: `src={{@model.imageUrl}}`, `alt={{@model.cardTitle}}`
- JS computed getters: `this.args.model.x` (internal TS, not template)
