## Use Container Queries, Not Viewport Units

Cards are placed inside containers that may be much smaller than the viewport. Always use CSS container queries for responsive layout instead of viewport-based media queries or `vw`/`vh` units. Use container query units instead of `vw` inside `clamp()`:

- **Fitted** (`container-type: size`): prefer `cqmin` — scales to the smaller of width or height, preventing overflow in the constrained dimension
- **Embedded / Isolated** (`container-type: inline-size`): use `cqi` — only the inline axis is available

The host `field-component` provides named containers automatically, but **fitted templates still must follow the Boxel fitted implementation standard in `boxel/references/container-query-fitted-layout.md`**: declare a local `.cq` size container that wraps a `.fit` layout element. That local two-element pattern is required because the fitted template needs a stable styling target and both-axis size queries.

Host-provided named containers are still useful context:

| Format   | Named container | Container type                                                |
| -------- | --------------- | ------------------------------------------------------------- |
| Fitted   | `fitted-card`   | `size` (both axes — width and height breakpoints both matter) |
| Embedded | `embedded-card` | `inline-size` (width only)                                    |

```css
/* Fitted wrapper context, when needed outside the local .cq -> .fit skeleton */
@container fitted-card (max-width: 150px) and (max-height: 169px) { ... }

/* Embedded — named or anonymous both work */
@container embedded-card (max-width: 400px) { ... }
```

For isolated templates, the parent does not provide a named container — declare `container-type: inline-size` with a name on your own root element and use that name in `@container` rules.

**Named containers are safer in nested situations.** An anonymous `@container` matches the nearest ancestor with any `container-type`, which could be an unintended intermediate container. `@container fitted-card (...)` skips anonymous containers and always resolves to the nearest ancestor with that specific name — so nested fitted cards each correctly target their own wrapper.
