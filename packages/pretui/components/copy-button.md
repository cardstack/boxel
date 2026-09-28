## What it is

An **IconButton** that copies a string to the clipboard and confirms it by swapping its glyph to a green check. Use it next to any value a user will want to paste elsewhere — an id, a URL, an API key, a **Token**. If the thing to copy is a whole block of code, put one of these in its corner rather than making the block clickable. If the action is "share" rather than "copy", that is a **Menu** or a **Popover**.

## The contract

```
@text: string | null | undefined   (required)
@label?   (default 'Copy to clipboard')
@variant? 'primary' | 'secondary' | 'ghost' | 'destructive'
Element: HTMLButtonElement
```

**`@text` accepts null and undefined and no-ops on them.** That is deliberate: the value being copied usually comes from a field that may not be set, and the alternative — a button that copies the string "undefined" — is worse than one that does nothing.

**The confirmation resets on `pointerleave` and `blur`, not on a timer.** Realm components own no timers, so the usual "revert after 2 seconds" is unavailable. What replaced it is arguably better: the confirmation lives exactly as long as the user's attention does. Move the pointer away or tab off, and it resets. A user who stays looking at the button keeps seeing "Copied".

**`@label` becomes the accessible name and swaps with the state** — 'Copy to clipboard' → 'Copied'. Because it flows into IconButton's `@label`, it is applied as both `aria-label` and `title`.

Clipboard failures are caught and logged to the console rather than surfaced; the button simply does not confirm.

## Prior art

**Web Awesome `wa-copy-button`** is the fullest: `value`, `from` (copy from another element's property or attribute by id), `copy-label` / `success-label` / `error-label`, `feedback-duration` (default 1000ms), `tooltip-placement`, and separate `copy-icon` / `success-icon` / `error-icon` slots — plus a real error state when the clipboard API rejects. **shadcn** has no copy button; it is a docs recipe with `useState` and a `setTimeout`.

**boxel-ui's own copy-button rides Tooltip via ember-velcro's wormhole**, which is on this kit's wart list — the portal escapes the theme island — so this is a fresh implementation rather than a wrap.

Where Pretui differs and is arguably ahead: **attention-scoped confirmation** (above) instead of a fixed duration. Web Awesome's 1000ms is a guess that is too short if you looked away and too long if you are clicking several in a row; tying it to pointer and focus makes it correct in both cases.

Where it is behind, plainly:

- **No error state.** `navigator.clipboard.writeText` rejects in insecure contexts, without permission, and when the document is not focused. Web Awesome shows an error label; here the failure is a `console.error` and a button that silently did not confirm. The user is not told the copy failed, which is the worst of the three outcomes.
- **No `from` equivalent** — you must have the string, not a reference to an element.
- **No `variant`-independent success colouring beyond the check's `--success`.**

## Accessibility

No APG pattern; a native `<button>`. Space and Enter both activate.

What is right:

- **The accessible name changes with state**, so a screen-reader user who re-reads the button after copying hears "Copied". The glyphs are `aria-hidden`, so the SVGs contribute nothing.
- **The reset triggers include `blur`**, which means the state does not get stuck for keyboard users the way a pointer-only reset would.

Gaps, and the first is significant:

- **The success is not announced.** Changing `aria-label` on a button does not fire a live-region announcement — a screen-reader user who presses the button hears nothing at all and has no confirmation that anything happened. The change is only discovered if they navigate away and back. This is the component's most consequential gap, and the fix is a visually-hidden `role="status"` region that the confirmation text is written into.
- **A failed copy announces nothing either** (above), so the user cannot distinguish "copied" from "failed" without checking the clipboard.
- **`blur` resets the state**, which interacts badly with the announcement gap: if a live region were added, the message would need to survive the focus change that resets the label.
- **APG's toggle-button guidance says a button's label must not change with state** — that rule is about `aria-pressed` toggles, and this is not one (it is a transient confirmation, not a persistent state), so changing the label is defensible here. But it does mean the button's name is unstable, which some voice-control users will find confusing: "click copy to clipboard" stops working for a moment after a copy.
- **`title` is inherited from IconButton** and duplicates the `aria-label`, with the usual double-announcement risk.
- **The check is `--success` at 13px** — a small green tick, and colour plus shape are the only visual confirmation. The shape change (clipboard → check) carries it without colour, which satisfies **WCAG 1.4.1**.
- Target size is IconButton's 28×28, clearing WCAG 2.5.8's minimum narrowly.

## Theming

`--success` (the confirmation check) plus **IconButton**'s and **Button**'s full token set for the button itself — `--pretui-tone`/`--pretui-tone-on` per variant, `--radius`, `--hover`, `--border`, `--control-h`.

`data-state="copied"` is reflected on the button, so a season can dress the confirmed state beyond the glyph swap — a tinted background, for example — without touching the component. That is the intended extension point, and it is worth using: a colour-only-by-default confirmation on a 28px button is easy to miss.
