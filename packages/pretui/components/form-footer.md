## What it is

The action bar at the bottom of a record-style form: a live status line on the left, Cancel and Save on the right, docked to the bottom of the form's scroll container. Reach for it when edits are committed per field and saved as a batch — the `record` mode of **Form**, or a **RecordDetail**. For a simple submit form, put buttons in `Form`'s `<:footer>` block or use a **ButtonGroup**; for a page-level toolbar, use **Toolbar** or **ActionBar**.

## The contract

```
@count? (0)        — fields carrying a committed-but-unsaved edit
@issues?           — already-computed; blocking ones disable Save
@saving?, @disabled?
@saveLabel? ('Save'), @cancelLabel? ('Cancel')
@dock? 'sticky' | 'static'   (default 'sticky')
@onSave?, @onCancel?
<:status>   <:actions>
```

Save is disabled when any of four things is true: `@disabled`, `@saving`, there is at least one blocking issue, or `@count === 0`. That last one is the opinionated part — a footer with nothing pending offers no Save, because a save button that does nothing teaches users that the button does nothing.

Severity follows the territory's fail-closed rule: `'error'` blocks, and so does anything unrecognised. The footer never evaluates issues, only counts them.

`<:status>` replaces the generated sentence entirely, for when "3 unsaved changes" is the wrong sentence for the domain.

## Prior art

Ported from **SLDS `docked-form-footer/base`** (`.slds-docked-form-footer`). Four improvements, each specific:

- **SLDS is `position: fixed; bottom: 0; left: 0; width: 100%` at an overlay z-index.** Inside a Boxel card that is a bug, not a style choice: the bar escapes the card's bounding box and floats over the whole host app, and `position: fixed` is lint-flagged in this codebase for exactly that reason. Pretui's is `position: sticky; bottom: 0`, docking to the bottom of the form's own scroll container and staying inside the card. `@dock='static'` returns it to normal flow.
- **SLDS shows no count of what is pending.** A batched save that will not say how much it is about to write is asking for blind trust. Pretui states the count in an `aria-live="polite"` region, so the number is announced as fields are edited and undone.
- **SLDS's error state is a bare icon button plus a hand-positioned Popover at a hardcoded z-index.** Pretui states the blocking-error count as text, disables Save, and points Save's `aria-describedby` at that text — so **the reason a control is disabled is actually reachable**. This is the single most useful thing in the component and the thing most disabled buttons in most design systems get wrong.
- **SLDS's buttons are `slds-button_neutral` / `_brand` literals**; Pretui's are the kit's **Button**, so tone and appearance travel with the season.

Deliberately dropped from upstream: the error Popover. **Popover** is the right tool and the footer should not grow a second one — a caller who wants a click-to-jump error list puts it in `<:status>`, or uses **ErrorSummary**.

## Accessibility

No APG pattern. Governed by WCAG **4.1.3 Status Messages**, **3.3.1 Error Identification** and **1.3.1**.

What is right:

- **The status line is `role="status"` with `aria-live="polite"`**, and it is in the DOM from first render — which is the requirement most live-region implementations miss. Content changes are announced; the region is never mounted with content already in it.
- **`aria-describedby` on Save points at the status text.** A screen-reader user who lands on a disabled Save is told why. Compare the usual `disabled` button with no explanation, which is a dead end.
- The error icon is `aria-hidden`, so the count sentence is not polluted.
- `@saving` puts Save into **Button**'s busy state and locks Cancel.

Gaps:

- **Save uses the native `disabled` attribute** (via Button), so it leaves the tab order entirely — and a control outside the tab order cannot be reached to hear its `aria-describedby`. The wiring that explains *why* Save is disabled is only announced if the user gets to Save some other way. `aria-disabled` plus a no-op handler would make the explanation reachable, and this is the component's most consequential gap given that reachable-explanation is its headline improvement.
- **`aria-live="polite"` on a count that changes per keystroke** will chatter in a form with per-field commits. The polite level and the coarse granularity (a whole-number count) keep it tolerable, but a debounce would be kinder.
- **`@saving` announces nothing** beyond the button's visual spinner — Button sets no `aria-busy`.
- **`position: sticky` and WCAG 2.4.11 Focus Not Obscured**: a docked bar can cover a focused control at the bottom of a scrolled form. Sticky is far better than SLDS's fixed here, but `scroll-margin-bottom` on the form's fields would close it properly.
- The status text is the only signal of the error count; there is no link from the footer to the errors themselves (that is `<:status>`'s job, by design).

## Theming

`--card` or `--inset` for the bar, `--border` and `--pretui-shadow-hairline` for its top edge, `--muted-foreground` for the clean state, `--destructive` for the error state, `--foreground` for the dirty state, plus **Button**'s full token set for the two actions.

`data-dock` (`sticky`/`static`) and `data-state` (`clean`/`dirty`/`error`) are reflected on the root, so a season can tint the bar by state without reaching inside. A season that gives the bar a transparent background will let form content show through while scrolling under it — give it an opaque `--card` or a backdrop.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
