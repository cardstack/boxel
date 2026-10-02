## What it is

A drag-and-drop file target with a real picker behind it: drop files on the zone, or press Browse, and get the ones that passed screening.

For a single slot that also previews what landed, that is **AssetWell**. For a button with no zone, **FileTrigger**.

## The contract

```
@accept?      — an <input accept> list, enforced on BOTH the picker and the drop
@multiple?    — allow more than one file per batch
@maxSize?     — largest single file, in bytes
@maxFiles?    — how many files one batch may contribute
@disabled?    — dimmed and inert; drops are ignored
@label?       — the headline inside the zone
@hint?        — the second line
@browseLabel? — the browse button's text
@icon?        — icon-registry name for the zone's glyph. Default 'File'
@onSelect?    — receives everything that passed screening. Never called empty
@onReject?    — receives everything that did not, with a reason each

<:default> — replaces the zone's body copy
```

**Screening applies to both paths.** A rule enforced on the picker but not on the drop is a rule that will be discovered by a user rather than by a developer, which is the most common defect in this component across every kit.

**Rejections are reported with a reason each**, rather than being dropped silently or collapsed into one failure.

**`@onSelect` is never called with an empty list**, so a caller never has to guard against a no-op batch.

**`<:default>` replaces the body copy and nothing else.** The browse button and the status region are not part of the block — they are the accessibility floor and cannot be designed away.

## Prior art

**React Spectrum's Dropzone.**

Where Pretui is better: the block that deliberately cannot remove the keyboard path. A dropzone whose entire contents are caller-supplied is a dropzone that will ship without a browse button, because a designer looking at a drop target does not see the button as part of the design. Making it structurally unremovable is the fix.

Where it is thinner: no directory drops, no per-file progress — a batch is handed over and the caller owns everything after — no paste-to-upload, and no preview of what landed; that is **AssetWell**'s job.

## Accessibility

- **A real file input sits behind the zone**, so the control is operable by keyboard with no custom key handling.
- **The browse button is structurally guaranteed.** It is outside `<:default>` precisely so it survives every customisation.
- **The status region is likewise outside the block**, so what happened to a batch is always announced.
- **Drag-and-drop is a pointer gesture with no keyboard equivalent**, which is exactly why the button is the floor rather than an enhancement.
- **Rejections carry a reason**, which is what turns "nothing happened" into "that file is too large".
- **`@disabled` ignores drops as well as clicks**, so a disabled zone cannot accept files through the path that has no visible affordance.

## Theming

`--pretui-dropzone-glyph-size` (the zone's icon), `--pretui-dropzone-transition` (the hover and drag-over state change), `--pretui-shadow-hairline` (the zone's edge).

The transition token is shared across the zone's states so that empty, hover and drag-over read as one surface responding rather than three separate treatments — the failure mode being a drag-over state that snaps in hard enough to look like a different component.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
