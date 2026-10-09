## What it is

The **image agents reach for**: a picture in a frame that reserves its ratio before the bytes arrive, with a load state, a fallback source, a failure face instead of the browser's broken-image icon, and an optional preview. Use it for photos, product shots, avatars at a size and illustrations in cards.

Reach for a neighbour in these cases:

- **AspectRatio** is the plain frame Image sits in. Use it directly for iframes, maps and charts, or for a painted background image.
- **ImageFrame** is the adapter **MediaViewer** renders a resolved media asset with, including its dimensions caption.
- **Lightbox** is a gallery grid with full-screen zoom and pan.
- **Avatar** is an identity disc with initials.
- **Skeleton** is the placeholder before you even know which image to show.

## The contract

```
@src?, @alt (required; '' = decorative)
@srcset?, @sizes? (responsive candidates; @src stays the fallback)
@ratio? (number or '16 / 9'; defaults to @width / @height, then 4 / 3)
@fit? ('cover' | 'contain'; default 'cover')
@width?, @height?, @loading? ('lazy' | 'eager'; default 'lazy')
@fallback?, @preview?, @previewLabel? (default 'View larger')
@radius?, @bordered?, @onStatusChange?
<:fallback>   — what shows when every source has failed
Element: HTMLDivElement
```

**The frame is reserved first.** Image renders inside an **AspectRatio**, so its box has its final shape before the image decodes and nothing around it reflows (Law 8). Without `@ratio`, `@width` / `@height` supply one. Without those, it falls back to 4 / 3 instead of collapsing to zero height.

**`@alt` is required, and empty is a decision.** There is no default alt. `@alt=''` renders a decorative `<img alt="">`, and any other value is the image's accessible name.

**Three states, reported.** `data-status` on the frame is `loading`, `loaded` or `error`, and `@onStatusChange` fires on each change. While loading, the frame shows a shimmer on the ground colour and the image is transparent. It fades in once decoded. An image that finished before its listeners were attached, such as one from cache, is read on insert, so it never stays stuck in `loading`.

**One fallback, then a face.** When `@src` fails, `@fallback` is tried once. A fallback identical to `@src` is not retried. When everything has failed, the broken `<img>` is removed and replaced with the `<:fallback>` block, or by default a picture glyph with the alt text written out, so the reader still learns what was meant to be there. A missing `@src` is a failure too. A new `@src` starts the whole sequence over.

**`@srcset` lets the browser pick the size.** Hand it a width set (`photo-960.webp 960w, photo-1600.webp 1600w`) and a `@sizes` saying how wide the image is drawn, and a phone downloads the 960 while a retina desktop takes the 1600. `@src` stays the fallback for a browser that ignores the set. `sizes` and `srcset` are set before `src`, so nothing is fetched twice. Once `@fallback` takes over, the set is dropped with it, so a set that failed alongside `@src` never shadows the fallback.

**`@preview` opens it larger.** The frame becomes a button. Click or Enter opens a **Dialog** with the image shown `contain` at up to 75% of the viewport height. The button is disabled until the image has loaded, so it never opens onto a broken picture.

## Prior art

**Ant Image** takes `src`, `alt`, `fallback`, `placeholder`, `preview` (with a full toolbar: zoom, rotate, flip, and a group mode) and `width` / `height`. **Mantine Image** takes `src`, `fallbackSrc`, `fit`, `radius` and `h` / `w`. **Chakra Image** takes `fallbackSrc` / `fallback` and `fit`. **MUI** has no component and relies on the plain `img`. Next.js `Image` is the other reference agents know: required `alt`, required dimensions, and reserved space.

Where Pretui is better: **the ratio is always reserved.** Ant and Mantine reserve space only when the caller sets both dimensions, and a missing height is the most common layout-shift bug. **`alt` is required** at the type level, as in Next.js and unlike every component kit above. **Failure keeps the meaning**: the default face writes the alt text out, where Ant and Mantine show a generic placeholder image. **State is observable** through `data-status` and `@onStatusChange`, which Mantine does not expose.

Where it is thinner: **the preview is plain.** There is no zoom, rotate, pan or gallery stepping. Use **Lightbox** for those. There is **no `srcset` / `sizes`** for responsive sources, and **no custom placeholder slot**: the loading state is the shimmer. **One fallback source**, where Ant accepts a node.

## Accessibility

No APG pattern. The rules are about names.

- **The image's name is `@alt`.** An empty alt stays `alt=""`, which is correct for decoration. The tests assert both.
- **With `@preview`, the button carries the name**: "View larger: Estate at dawn", with `aria-haspopup="dialog"`. The inner `<img>` is `alt=""`, so the name is not read twice. The tests assert all three. The dialog's image carries the real alt, and the dialog is labelled by it.
- **The failure face keeps the name.** The alt text is shown and exposed as `role="img"` with that label, so a screen reader user hears what is missing rather than nothing. The glyph is `aria-hidden`. The tests assert the label on the failure face.
- **The preview button is disabled while loading**, so keyboard users cannot open an empty dialog.
- **Write alt for the context.** The same photo needs different alt text on a product page and in a gallery thumbnail. The component cannot know which, so the text is the caller's job.

## Theming

Image reads **AspectRatio**'s tokens for the frame: `--pretui-aspect-ratio`, `--pretui-aspect-radius` (from `@radius`), `--pretui-aspect-bg` (the loading and failure ground) and `--pretui-shadow-hairline` for `@bordered`. It adds `--card` for the shimmer highlight, `--muted-foreground` and `--text-ui-sm` for the failure face, `--ring` for the preview button's focus ring, `--space-2` / `--space-4`, and `--pretui-dur-enter` / `--pretui-ease-enter` for the fade-in.

The shimmer and the fade are dropped under `prefers-reduced-motion`. `object-fit` follows `@fit`. The preview's 75vh height cap is fixed.

The styles sit in `@layer PretComposite`, above AspectRatio's `PretComponent` layer, so what this component sets on AspectRatio wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.

## React ecosystem

| Agent types                            | Give them                                 |
| -------------------------------------- | ----------------------------------------- |
| `<img src alt>`                        | `<Image @src @alt />`                     |
| Ant `fallback` / Mantine `fallbackSrc` | `@fallback`                               |
| Ant `preview`                          | `@preview` (plain), or **Lightbox**       |
| Ant `placeholder`                      | the built-in loading shimmer              |
| Mantine `fit="contain"` / `radius`     | `@fit='contain'` / `@radius`              |
| Next.js `<Image width height>`         | `@width` / `@height` (they set the ratio) |
