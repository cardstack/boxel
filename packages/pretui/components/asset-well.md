## What it is

One asset, one slot: the drop zone and preview for a single file. Five states — empty, drag-over, in-flight, filled, failed — over a real `<input type='file'>`, so the pointer gesture and the keyboard path are the same control rather than two.

Use it for a card's image, an avatar, an attachment. For many assets, that is **AssetGrid**; for a curated set with a hero, **Gallery**.

## The contract

```
@asset?, @defaultAsset?, @onAssetChange? — controlled / uncontrolled slot;
                        null means "deliberately empty"
@onSelect?     — THE event: fires with the accepted File, before any preview exists
@onReject?     — fires with everything that failed screening, one reason each
@onRemove?     — fires when the reader clears the slot
@onRetry?      — fires from the failure state's retry button
@onCancel?     — fires from the in-flight state's cancel button
@uploading?, @uploadFraction?, @errorMessage? — the state levers
@accept?       — an <input accept> list, enforced on BOTH the picker and the drop
@maxSize?      — largest acceptable file, in bytes
@label?, @hint? — the empty invitation's two lines
@ratio?        — reserved preview ratio; defaults to the asset's own, then 4 / 3
@icon?         — icon-registry name for the empty glyph. Default 'ImagePlaceholder'
@disabled?     — dimmed and inert; drops are ignored
@viewOnly?     — preview only, nothing that mutates
@altLabel?     — offer an alt-text line under the preview

<:preview> replaces the preview; receives the resolved asset
<:empty>   replaces the invitation's copy — but NOT the browse button
<:actions> extra controls beside Remove
```

**Upload is yours; the well never does it.** `@onSelect` fires with the accepted `File` before any preview exists, which is the moment to start uploading. The well then reflects what you tell it through `@uploading`, `@uploadFraction` and `@errorMessage`.

**Four states resolve from three arguments in a fixed precedence**: failure beats in-flight, in-flight beats filled, filled beats empty. That ordering is the contract — a well that is both uploading and holding an old asset shows the upload.

**Omit `@uploadFraction` while uploading and you get an indeterminate spinner.** A fake percentage is a lie with a progress bar around it.

**Retry and cancel exist only when they can work.** No `@onRetry`, no retry button — an affordance that does nothing is worse than none.

**`@accept` and `@maxSize` are enforced on both paths.** A rule applied to the picker but not to the drop is a rule that will be discovered by a user rather than by a developer.

**A real file input sits behind the zone in every state**, and the browse button is a real `<button>` whose wording follows the state. That is why `<:empty>` replaces the copy but not the button: the button is the keyboard path and cannot be designed away.

**The preview routes through MediaViewer** rather than assuming an `<img>`, so a well holding a video or an audio file previews correctly.

## Prior art

**boxel-catalog's image-source-editor** is the source, with **React Aria's FileTrigger** as the reference for the input-behind-the-zone pattern.

Where Pretui is better, and the first one is a bug fix rather than a feature: **the catalog source hardcoded `alt=''`, which made every image it produced permanently undescribable.** `@altLabel` is the fix, and it is opt-in rather than always-on only because some slots really are decorative. Beyond that: five states rather than two, rejection reported with a reason per file rather than a silent refusal, and screening applied to the drop as well as the picker.

Where it is thinner: no crop or focal-point step after a pick (**ImageCropper** is a separate component and the two do not compose today), no multi-file mode — by design, but it means a caller wanting two slots renders two wells and coordinates them — no paste-from-clipboard, and no resumable or chunked upload contract beyond cancel and retry.

## Accessibility

- **The file input is real and present in every state**, so the control is reachable and operable by keyboard without any custom key handling.
- **The browse button is a real button whose label follows the state**, so a screen-reader user is told whether they are adding or replacing.
- **The failure carries a word and a role, not a colour.** The reason is text on the screen rather than a red border, which is the difference between a recoverable error and a mysterious one.
- **Remove announces itself**, reports `null` through `@onAssetChange`, and calls `@onRemove` — the state change is perceivable rather than silent.
- **`@viewOnly` keeps the preview and drops every mutation**, so a read-only slot has no focusable controls that lead nowhere.
- **`@altLabel` is the accessibility affordance that matters most here**, because it is what stops the asset from being undescribable downstream. Offer it whenever the image carries meaning.
- **The empty state's glyph is `aria-hidden`**; the invitation's text carries the meaning.

## Theming

`--pretui-well-aspect` (the reserved preview ratio), `--pretui-well-glyph-size`, `--pretui-well-transition`, plus the `--pretui-well-*` family for the state surfaces, `--pretui-on-neutral` and `--pretui-shadow-hairline`.

Reserving the ratio before the bytes arrive is why a card holding a well never reflows when its image loads — the same rule **ImageFrame** and **MediaPlayer** follow, and the reason all three take a ratio rather than inferring one late.

A season retunes the five state surfaces through the `--pretui-well-*` tokens together, which keeps the empty, hover, in-flight, filled and failed states reading as one control changing rather than five different components.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
