## What it is

**Separator** is **Divider** under the name shadcn, Radix and React Aria use. The export is the same component. Import it when a port already says Separator; the **Divider** writeup carries the depth.

## The contract

```
@orientation? ('horizontal' | 'vertical'; default 'horizontal')
@label?          — a centred label, horizontal only
Element: HTMLDivElement
```

Identical to Divider: a `role="separator"` with an explicit `aria-orientation`.

## Prior art

**Radix `Separator`** takes `orientation` and `decorative`. `decorative` drops the role so a purely visual rule is not announced. **shadcn** wraps Radix. **React Aria `Separator`** takes `orientation` and `elementType`.

Divider adds a centred `@label` ("or") that Radix leaves to composition. It has no `decorative` arg: a rule used only for rhythm still reaches the accessibility tree. Pass `aria-hidden='true'` through attributes to take it out.

## Accessibility

Identical to Divider. It is `role="separator"` with `aria-orientation`. `@label` becomes the separator's `aria-label`. Every Separator is announced, including decorative ones, until the call site adds `aria-hidden='true'`. A vertical Separator with a `@label` keeps the name but hides the text, which is a call-site mistake.

## Theming

Identical to Divider: `--border` (the rule), `--muted-foreground` and `--text-ui-sm` / `--track-ui` (the label), and `--pretui-divider-spacing` (the margin around it, default `--space-4`).

## React ecosystem

| shadcn / Radix / React Aria | Pretui                                  |
| --------------------------- | --------------------------------------- |
| `<Separator />`             | `<Separator />`                         |
| `orientation="vertical"`    | `@orientation='vertical'`               |
| `decorative`                | `aria-hidden='true'` through attributes |
| a label between two rules   | `@label='or'`                           |
