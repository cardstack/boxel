## Use Container Queries, Not Viewport Units

Cards are placed inside containers that may be much smaller than the viewport. Always use CSS container queries for responsive layout instead of viewport-based media queries or `vw`/`vh` units. Use container query units instead of `vw` inside `clamp()`:
- **Fitted** (`container-type: size`): prefer `cqmin` — scales to the smaller of width or height, preventing overflow in the constrained dimension
- **Embedded / Isolated** (`container-type: inline-size`): use `cqi` — only the inline axis is available

The host `field-component` provides named containers automatically. **For fitted templates, follow the Boxel fitted implementation standard in `boxel/references/container-query-fitted-layout.md`**: the host establishes a `size` container named `fitted-card` around every fitted template — query it (`@container fitted-card (...)`); never create your own container on the root (the child contract in `delegated-render-control.md` forbids `container-type`/`container-name` there). For standard compositions, prefer the `FittedCard` component from `@cardstack/boxel-ui/components`, which implements those queries internally.

The host-provided named containers:

| Format | Named container | Container type |
|---|---|---|
| Fitted | `fitted-card` | `size` (both axes — width and height breakpoints both matter) |
| Embedded | `embedded-card` | `inline-size` (width only) |

```css
/* Fitted — query the host-provided container */
@container fitted-card (max-width: 150px) and (max-height: 169px) { ... }

/* Embedded — named or anonymous both work */
@container embedded-card (max-width: 400px) { ... }
```

For isolated templates, the parent does not provide a named container — declare `container-type: inline-size` with a name on your own root element and use that name in `@container` rules.

**Named containers are safer in nested situations.** An anonymous `@container` matches the nearest ancestor with any `container-type`, which could be an unintended intermediate container. `@container fitted-card (...)` skips anonymous containers and always resolves to the nearest ancestor with that specific name — so nested fitted cards each correctly target their own wrapper.
