## What it is

The image adapter: a still picture with its aspect ratio reserved before the bytes arrive, real alt text, and its pixel dimensions printed underneath as a machine value.

It is what **MediaViewer** renders for an `image` asset, and it takes a resolved asset rather than loose args — so you rarely construct one directly. Reach for it when you have a `ResolvedMediaAsset` in hand and want the image without the router.

## The contract

```
@asset (required) — a ResolvedMediaAsset: src, label, alt?, width?, height?
```

One arg. Everything the frame renders is derived from it.

**The aspect ratio is reserved as a custom property before the image loads**, which is what stops the picture's arrival from reflowing the page. The ratio comes from the resolved asset — `width / height`, rounded — and goes through the kit's CSS guard rather than being interpolated. A ratio that does not pass the guard is dropped entirely, so the frame falls back to the stylesheet's own `auto` instead of carrying half a declaration.

**Alt text falls back to the label.** `asset.alt` wins; without it the frame uses the asset's resolved label, which is the caller's `name` or the basename of the URL. That is a worse alt text than a real one and better than an empty attribute on a content image.

**Dimensions are shown only when both are known**, rendered through **Token** as `800 × 600` — a machine value in the mono treatment, not prose.

**The image is lazy-loaded and asynchronously decoded**, and carries its intrinsic `width` and `height` attributes as well as the CSS ratio, so the browser can reserve space even before the stylesheet applies.

## Prior art

A kit addition — the adapter **MediaViewer** routes image assets to. The comparison is against the bare `<img>` a call site would otherwise write, and the three things it tends to get wrong: no reserved space, so the page jumps when the image arrives; alt text omitted entirely rather than derived from something; and dimensions either absent or rendered as prose.

Where it is thinner: there is no fit or crop control — the frame does not take `object-fit`, a focal point, or a max height — no zoom, and no loading or error state of its own. A broken image renders as the browser's broken-image affordance with the alt text beside it. **ImageCropper** owns framing, **Lightbox** owns zoom.

## Accessibility

- **The alt text always exists**, because it falls back to the label rather than to nothing. Worth being explicit about the consequence: a decorative image passed through this frame will be announced by its filename, which is noise. This component assumes its image is content — if it is decoration, it is the wrong component.
- **The reserved ratio is an accessibility feature, not only a visual one.** Content that reflows under a reader who is partway down the page is the same failure whether they are using a screen magnifier or not, and reserving the box removes it.
- **The dimensions line is a `<p>` containing a Token**, so it is announced as text after the image rather than being conveyed by the image's own name.
- **Nothing here is focusable**, which is correct: a still image with no zoom has nothing to operate.

## Theming

`--pretui-frame-aspect` (the reserved ratio, written per instance and defaulting to `auto` in the stylesheet), plus `--pretui-shadow-hairline` shared across this module.

The 8px gap between picture and dimensions is fixed. The dimensions themselves inherit **Token**'s treatment, so a season that retunes the mono jewellery retunes this line with it rather than needing a frame-specific value.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
