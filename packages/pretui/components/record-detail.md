## What it is

The record page: a grid of fields that are read-only until you click a pencil, edited one at a time, accumulated into a batch, and saved together from a docked footer. Use it for the detail view of a record — the resting state of an object a user reads far more often than they edit. If everything is editable at once, that is a **Form** in `submit` or `live` mode. If the record is read-only, **KeyValue** is far less machinery.

## The contract

```
@issues / @columns? (1–4, default 2) / @layout? ('stacked' | 'horizontal')
@readOnly?, @placeholder? ('—'), @saving?, @hideFooter?, @summary? (default shown)
@onSave?(changes: Record<string, unknown>), @onCancel?
<:default as |{ Field, Compound, state }|>
```

`state` is `{ dirtyCount, dirtyPaths, editingPath, save, cancel }` — enough to drive a custom footer or a header badge.

**Exactly one editor is open at a time.** `editingPath` is a single value, not a set. That is the SLDS record-page model and it is what makes the batch legible: a user edits a field, commits it to the draft, and the field returns to its read view showing the pending value. Multiple simultaneous editors would make "what have I changed" unanswerable.

**The draft is a plain object replaced wholesale on write**, so the tracked read stays a property read — no `TrackedMap` needed. `dirtyPaths` is `Object.keys(draft)`.

**`@onSave` receives `{ [path]: value }` and the draft clears optimistically the moment it fires.** The host writes and hands back new values. That optimism is a deliberate choice with a consequence: a failed save must re-supply the values, or the user's edits are gone from the UI.

**`lastClosed` exists for exactly one render.** When an editor closes by an explicit gesture, focus travels back to that field's trigger — a single-render flag rather than a persistent state, which is the correct shape for a focus hand-off.

## Prior art

Ported from **SLDS's `record-detail`** — the Salesforce record page, which is the most-used implementation of this pattern anywhere. **React Spectrum**, **Radix**, **Web Awesome** and **shadcn** ship nothing comparable; inline-edit record pages are enterprise territory.

Where Pretui improves on SLDS:

- **The batch is exposed as state.** `dirtyCount`, `dirtyPaths` and `editingPath` are yielded, so a header badge, a custom footer or a route guard can all read the same truth. SLDS's is internal.
- **The docked footer is `position: sticky`, not `position: fixed`** — see **FormFooter**'s note: SLDS's fixed footer escapes a card's bounding box and floats over the host app.
- **Focus returns to the field's trigger when an editor closes**, which SLDS does not do; its inline edits drop focus.
- **The issue summary is a real ErrorSummary**, so nothing is dropped — including issues whose `targetPath` matched no rendered field.
- **`@columns` is clamped to 1–4 and rounded**, so a bad value degrades rather than producing a broken grid.

Where it is behind SLDS's product: no field-level history, no "recently viewed", no related-lists region, and no per-field permission model — `@readOnly` is all-or-nothing.

## Accessibility

No APG pattern; it is a record page composed of **FormField**s, **CompoundField**s, an **ErrorSummary** and a **FormFooter**, and it inherits each of their contracts.

What is right, and the focus work is the notable part:

- **Focus returns to the field's trigger when an editor closes.** Inline-edit patterns lose focus constantly — you click a pencil, edit, commit, and focus is on a button that no longer exists. The `lastClosed` single-render flag is the mechanism, and it is the difference between a usable and an unusable keyboard experience.
- **The batch count is stated in the footer's `aria-live="polite"` region**, and **FormFooter** points Save's `aria-describedby` at that text, so a user landing on a disabled Save is told why.
- **The issue summary announces by taking focus**, per **ErrorSummary**'s deliberate live-region policy, and its rows can open a collapsed **FormSection** and land focus inside.

Gaps:

- **Entering and leaving edit mode is not announced.** Clicking a pencil replaces a read view with a control; nothing says "editing Total". For a screen-reader user the field simply becomes something else. A `role="status"` announcement on `editingPath` change would close it, and it is the highest-value fix here.
- **The pending-value state is announced per field.** A field with a committed-but-unsaved edit adds "Unsaved change." to the hint its trigger's `aria-describedby` points at, beside the footer's total.
- **The optimistic draft clear** (above) means a failed save is silent unless the host re-supplies values *and* surfaces an error.
- **The pencil triggers need names that identify their field** — "Edit Total", not eight buttons called "Edit".
- **`@readOnly` turns every field read-only**, which is right, but there is no per-field permission, so a partially-editable record must be composed field by field.
- Everything **FormField**, **CompoundField** and **FormFooter** flag applies — notably that FormFooter's Save uses the native `disabled` attribute, so the explanation it points at is unreachable by tab.

## Theming

**FormField**, **CompoundField**, **FormLayout**, **ErrorSummary** and **FormFooter** tokens throughout; RecordDetail itself paints the grid and the read/edit affordances. `--muted-foreground` for the `'—'` placeholder, `--hover` for the pencil, and the pending-edit dress.

The pending-edit dress is the one thing a season must design deliberately: a field with an uncommitted change must be visibly different from both its resting and its editing state, in a page that may show thirty fields. It is the only visual answer to "what have I changed", and neither `--destructive` (wrong meaning) nor `--hover` (transient) is the right token — a season should define one for it.

The styles sit in `@layer PretComposite`, above IconButton's `PretComponent` layer, so what this component sets on IconButton wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
