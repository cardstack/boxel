## What it is

**Loader** is **Spinner** under the name shadcn and Mantine use. The export is the same class. Import it when a port already says Loader; the **Spinner** writeup carries the depth. Ant's `Spin` wrapping its children is a different component — that is **LoadingOverlay** — and a labelled "Loading…" row is **LoadingState**.

## The contract

```
@size?   — pixels, or any spelling of the xs · s · m · l · xl scale
```

Identical to Spinner. Colour is `currentColor`, so tint the wrapper, not the component.

## Prior art

**Mantine `Loader`** has a `type` enum (oval, bars, dots) and its own `color`; **shadcn `Spinner`** is a single SVG that takes a `className`; **Ant `Spin`** adds `spinning`, a `tip` and children to overlay. Spinner is one ring with one size arg. It inherits ink instead of taking a colour, which is what lets it sit inside any **Button** tone unchanged, and it has no wrapping mode.

## Accessibility

No APG pattern. Spinner renders `role="status"` with `aria-label="Loading"`; pass a more specific `aria-label` through `...attributes` so several spinners on one page do not all say the same thing. The region mounts with its name already in place, so the announcement is not guaranteed — write "Loaded 24 results" into a persistent live region when loading ends. Reduced motion slows the rotation to 2.8s rather than stopping it.

## Theming

`currentColor` for both the track (at 25% alpha) and the indicator; there are no spinner-specific tokens. The 1.5px stroke, 0.7s period and 13px default size are fixed. A season only needs `--foreground`, `--muted-foreground` and each Button tone's on-colour to read at 25% alpha.

## React ecosystem

| shadcn / Mantine / Ant         | Pretui                                      |
| ------------------------------ | ------------------------------------------- |
| `Loader` / `Spinner` `size`    | `@size`                                     |
| Mantine `type`                 | one ring; no enum                           |
| Mantine `color`                | wrapper `color`, inherited                  |
| Ant `Spin spinning` + children | **LoadingOverlay**                          |
| Ant `tip`                      | **LoadingState** / **LoadingOverlay** label |
