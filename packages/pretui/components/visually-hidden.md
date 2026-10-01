## What it is

**Text for assistive technology that takes no space on screen.** Use it to name an icon-only control ("Close dialog" inside a ✕ button), to add the context a sighted reader gets from layout ("3 unread" after an inbox icon), or to keep a heading in the outline while the design shows none. Pretui components that need this, such as **Badge**, **Indicator** and **Link**, use it themselves.

When not to use it: to hide something from everyone, use the `hidden` attribute or don't render it. To hide decoration from assistive technology, use `aria-hidden='true'`. **SkipLink** is the ready-made skip-navigation link built on the same idea.

## The contract

```
@focusable?   — show the content while it, or anything in it, has focus
<:default>    — the text
Element: HTMLSpanElement
```

**The clip pattern.** The span is absolutely positioned, 1px square, clipped to nothing with `clip-path: inset(50%)`, and `nowrap` so a screen reader reads it as one run. It is not `display: none`, `visibility: hidden` or `aria-hidden`: all three take the text out of the accessibility tree, which defeats the point.

`@focusable` undoes the clip while the span or something inside it has focus, for a link or button that should appear only to keyboard users.

## Prior art

**Radix `VisuallyHidden`**, **Mantine `VisuallyHidden`**, **Chakra `VisuallyHidden`** and **React Aria `VisuallyHidden`** are all this pattern. React Aria adds `isFocusable`, which is `@focusable` here. Tailwind's `sr-only` / `not-sr-only` classes are the utility form.

Where Pretui is better: it uses `clip-path` rather than the deprecated `clip: rect()` that several kits still ship. Where it is thinner: there is no `elementType`. It is always a `span`, so wrap it in the element you need.

## Accessibility

No APG pattern. This is the primitive the patterns use.

- **The text stays in the accessibility tree.** It carries no `aria-hidden` and no `hidden`, and its text is in the DOM of the button it names. The tests assert those three. They cannot assert the clip pattern itself, because the test harness loads no component CSS.
- **It takes no layout space.** The span is out of flow and 1px square, so it never shifts the visible content.
- **Don't use it to hide interactive controls.** A clipped button is still in the tab order, and a keyboard user lands on something invisible. Use `@focusable` so it appears on focus, or don't render it.
- **Say what a sighted reader gets, no more.** Extra hidden commentary makes a page slower to listen to, not better.

## Theming

No tokens. The span carries no colour or type of its own, and with `@focusable` it inherits both from where it sits once revealed.

## React ecosystem

| Agent types                                 | Give them                          |
| ------------------------------------------- | ---------------------------------- |
| `<VisuallyHidden>` (Radix, Mantine, Chakra) | `<VisuallyHidden>`                 |
| React Aria `isFocusable`                    | `@focusable={{true}}`              |
| Tailwind `className="sr-only"`              | `<VisuallyHidden>`                 |
| `elementType="div"`                         | not supported; it is always a span |
