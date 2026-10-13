## What it is

An **IconButton** that copies a string to the clipboard, swaps its glyph to a check (or a cross when the copy fails), and announces the result to screen readers. Use it next to any value a user will want to paste elsewhere — an id, a URL, an API key, a **Token**. If the thing to copy is a whole block of code, put one of these in its corner rather than making the block clickable. If the action is "share" rather than "copy", that is a **Menu** or a **Popover**.

## The contract

```
@text: string | null | undefined   (required; aliases @value, and @textToCopy as boxel-ui spells it)
@label?   (default 'Copy to clipboard'; alias @ariaLabel as boxel-ui spells it)
@tone?, @appearance?   (IconButton's; default 'neutral' / 'outlined')
@variant?   (deprecated sugar over @tone + @appearance)
@size?: 'xs' | 's' | 'm' | 'l' | 'xl'   (default 'm'; the glyph scales with it)
@disabled?
Element: HTMLButtonElement
```

**`@text` accepts null and undefined and no-ops on them.** That is deliberate: the value being copied usually comes from a field that may not be set, and the alternative — a button that copies the string "undefined" — is worse than one that does nothing.

**The result holds for 2 seconds, whatever the input.** Two seconds is where the field has settled (Web Awesome 1 s, Chakra 1.5 s, Mantine, shadcn and GitHub's clipboard-copy 2 s, Ant 3 s). A timer is the one reset, so mouse, keyboard and touch all see the same thing, and a keyboard user, whose focus stays on the button, is not left with a stale check.

**`@label` is the accessible name, and it does not change with the result.** It flows into IconButton's `@label`, so it is applied as both `aria-label` and `title`. The result is written into a `role="status"` region, a **VisuallyHidden**, instead: 'Copied', or 'Copy failed'.

**A failed copy is shown, not just logged.** `navigator.clipboard.writeText` rejects in insecure contexts, without permission, and when the document is not focused. The button then shows a cross in `--destructive-ink`, sets `data-state="failed"`, announces 'Copy failed', and logs the error to the console.

**The status region renders after the button, as a sibling.** A button's children are presentational, so a live region inside it would not be announced. The region is absolutely positioned and 1px, so it takes no space in flex, grid or inline layout, but a caller's `:last-child` selector will match it rather than the button. ButtonGroup matches its children by class, so a CopyButton at either end of a group still gets the group's outer corners.

## Prior art

**Web Awesome `wa-copy-button`** is the fullest: `value`, `from` (copy from another element's property or attribute by id), `copy-label` / `success-label` / `error-label`, `feedback-duration` (default 1000ms), `tooltip-placement`, and separate `copy-icon` / `success-icon` / `error-icon` slots — plus a real error state when the clipboard API rejects. **shadcn** has no copy button; it is a docs recipe with `useState` and a `setTimeout`.

**boxel-ui's own copy-button rides Tooltip via ember-velcro's wormhole**, which is on this kit's wart list — the portal escapes the theme island — so this is a fresh implementation rather than a wrap.

### Differences from boxel-ui CopyButton

- **No styled tooltip**, so `@tooltipText`, `@placement` and `@offset` are not accepted. The native `title` tooltip shows `@label`, and the glyph swap shows the result.
- **The result holds for 2 seconds** on every input, with no pointer or focus reset (above).
- **The accessible name stays fixed.** boxel-ui swaps `aria-label` to 'Copied', which a screen reader does not announce; here the status region announces it.
- **`@width` / `@height` are not accepted.** The glyph follows `@size`.
- **The root element is the button**, not a Tooltip wrapper, so `...attributes` land on the button.

Where Pretui differs and is arguably ahead: **the result is announced and the name stays fixed** (below), and a repeat copy is announced again. The 2-second hold itself is the field's standard, not a difference.

Where it is behind, plainly:

- **No `from` equivalent** — you must have the string, not a reference to an element.
- **The status text is fixed** ('Copied', 'Copy failed'); there is no `copy-label` / `success-label` / `error-label` equivalent.

## Accessibility

No APG pattern; a native `<button>`. Space and Enter both activate.

What is right:

- **The result is announced.** A polite `role="status"` region, rendered from the start so assistive tech is already watching it, receives 'Copied' or 'Copy failed'.
- **The accessible name is stable**, so a voice-control command such as "click copy to clipboard" keeps working after a copy. The glyphs sit inside IconButton's `aria-hidden` face, so the SVGs contribute nothing.
- **The reset is a timer, not a focus change**, so a keyboard user who keeps focus on the button sees the check clear like everyone else. The reset empties the region, which announces nothing.

Gaps and cautions:

- **A repeat copy is announced again**: each click empties the region before the clipboard write, and the result lands after it; the glyph keeps the last result meanwhile, so nothing flickers. A result that arrives after the pointer or focus has already left is dropped, so nothing is shown or announced for a button the user is no longer on.
- **`title` is inherited from IconButton** and duplicates the `aria-label`, with the usual double-announcement risk.
- **The check is `--success-ink` and the cross `--destructive-ink`**, the hue tokens meant for ink on a neutral surface. On a fill (`accent`, `filled`, `filled-outlined`) they lose contrast, the cross on a filled hover surface measures under 3:1, so there the glyph keeps the fill's own text color. The shape change (clipboard → check or cross) carries the result without color, which satisfies **WCAG 1.4.1**.
- Target size is IconButton's 28×28, clearing WCAG 2.5.8's minimum narrowly.

## Theming

`--success-ink` (the check) and `--destructive-ink` (the cross) plus **IconButton**'s and **Button**'s full token set for the button itself — `--pretui-tone`/`--pretui-tone-on` per tone, `--radius`, `--hover`, `--border`, `--control-h`.

The three glyphs stay in the DOM and cross-fade (scale, opacity and blur over 300 ms) when the state changes, so the result both enters and leaves smoothly; under `prefers-reduced-motion: reduce` the swap is instant. `data-state="copied"` or `data-state="failed"` is reflected on the button, so a season can dress the confirmed state beyond the glyph swap — a tinted background, for example — without touching the component. That is the intended extension point, and it is worth using: a glyph-only-by-default confirmation on a 28px button is easy to miss.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
