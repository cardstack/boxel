## What it is

Crop, rotate and flip an image, with the crop box reachable by pointer *and* by four real sliders.

Use it after a pick — wire it between **AssetWell**'s `@onSelect` and your upload — or wherever a stored image needs reframing. For viewing rather than editing, **ImageFrame** or **Lightbox**.

## The contract

```
@src (required) — URL of the image to crop; passed through untouched
@alt?           — alt text; an empty string marks the image decorative
@label?         — accessible name of the crop controls. Default 'Crop'
@aspectRatio?   — locked ratio, or 0/omitted for free
@height?        — crop surface height in px. Default 320
@transforms?    — offer rotate and flip. Default true
@onChange?      — fires on every crop-box change, pointer or keyboard
@onExport?      — fires on Export, with a PNG data URL and the box
```

**The height is reserved before the image decodes**, so nothing reflows when it lands.

**The crop box is one state reachable two ways.** Pointer drag is Cropper's; the sliders are the kit's; both go through the same apply path, so they cannot disagree and there is no "keyboard mode" that behaves differently from the pointer.

**`@onExport` hands back a PNG data URL.** The component does not upload, resize or re-encode to anything else — what you do with the bytes is yours.

**The ratio list leads with free.** A locked ratio is a constraint you opt into rather than the default.

## Prior art

**Cropper.js v2** (MIT, web components), used declaratively — the custom elements are placed in the template, so there is no `new Cropper(img)`, no imperative mount and no instance to hold.

Where Pretui is better: **Cropper's own `keyboard` attribute is deliberately off, and the keyboard support is better for it.** That attribute attaches a keydown listener to the *document* — turn it on and every arrow key anywhere on the page nudges the crop box, whether or not the cropper has focus. That is not accessibility, it is a global hotkey with no owner. Four native `<input type='range'>` controls replace it, which means arrows, Shift, PageUp/PageDown, Home and End all behave the way the platform already defines them, with no re-implementation to get subtly wrong.

Where it is thinner: PNG export only — no JPEG, no quality control, no output-size cap — one crop box rather than several, no straighten-by-angle beyond the rotate steps, and no zoom or pan of the source under a fixed box. There is also no round or custom-shape crop.

## Accessibility

- **Four real sliders, one per edge of the box** — x, y, width, height — each a native range input, so the full platform key contract comes for free.
- **Each announces a value a human can act on**: "crop width 320 of 640 pixels" rather than a bare float. That phrasing is the difference between a usable slider and a technically-labelled one.
- **The four sliders are in a `role='group'` named by `@label`**, so they are announced as one control rather than as four loose ranges.
- **The ratio chips are a `role='group'` labelled "Crop ratio"**, each with `aria-pressed`, so the current lock is announced rather than shown only as a highlighted chip.
- **`@alt` with an empty string marks the image decorative**, which is right when the surrounding UI already says what is being cropped.
- **The error state carries a hidden glyph and visible text.**
- **No document-level key handling.** Focus decides what responds to the keyboard, which is the invariant the upstream's `keyboard` attribute breaks.

## Theming

`--pretui-crop-h` (the reserved surface height, from `@height`), `--pretui-destructive-ink` (the error state), `--pretui-shadow-hairline`.

The crop surface itself — the grid, the shading outside the box, the handles — comes from Cropper's own elements, which is the one part of this component a season does not reach. The chrome around it, the ratio chips and the sliders are the kit's and follow the season normally, so the editor reads as part of the product even though the crop surface is the library's.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
