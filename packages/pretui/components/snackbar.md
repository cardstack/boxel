## What it is

**Snackbar** is **Toast** under the name MUI uses: the brief status card alone, with no position, clock or live region of its own. The export is the same component. MUI's `Snackbar` is a card _and_ a host in one; Pretui splits those, so the host that stacks, ages and dismisses — MUI's `open` / `autoHideDuration` / `anchorOrigin` — is **Toaster** (**Sonner** is its shadcn name). The **Toast** writeup carries the depth.

## The contract

```
@title
@message? / @description?   — the second line; description is the Sonner spelling
<:icon> <:action>
```

Identical to Toast. Lifetime, placement and tone are not args here: they live on the item you `show()` into a Toaster.

## Prior art

**MUI `Snackbar`** owns `open`, `autoHideDuration`, `onClose`, `anchorOrigin` and `TransitionComponent`, and usually wraps an `Alert` for severity. Toast owns none of that: it is a title, a message and two slots, sized and shadowed to read as "floating above". The split is the point — one host implements the clock, the roles and the focus handling once, and the card stays ordinary content.

## Accessibility

Governing pattern: APG **Alert**. Toast hardcodes `role="status"` on the card and is its own live region, created with its content already in it, so a card that mounts complete is announced unreliably; there is no close control and no Escape handling. Render it inside a host that owns the region, the politeness and the dismiss, and pass `role={{null}}` so the card isn't a second region. **Toaster** owns all three but draws its own item, so it is the alternative to Snackbar, not a place to put one.

## Theming

Same as **Toast**; see its Theming.

## React ecosystem

| MUI Snackbar                            | Pretui                                                      |
| --------------------------------------- | ----------------------------------------------------------- |
| `message` / `action`                    | `@title` / `@message` / `<:action>`                         |
| `open` / `autoHideDuration` / `onClose` | **Toaster** — `show()` returns an id, `duration` in seconds |
| `anchorOrigin`                          | **Toaster** `@placement`                                    |
| `severity` (via Alert)                  | `tone` on the item shown into Toaster                       |
