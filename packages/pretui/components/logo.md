## What it is

The kit's brand mark: an app or company logo. Give it `@src` and the image is drawn whole (`object-fit: contain`, never cropped, any aspect ratio, SVG or raster). Give it only `@name` and it is a text wordmark, or the name's initials in a square tile when it is a mark. If the image is missing or fails to load, it falls back to the same text, so a broken URL never leaves a hole in the sidebar. It is not **Avatar**: Avatar is an identity disc that crops a photo to a square; a real logo has nowhere to go there.

## The contract

```
@src?        image URL (svg, png, jpg, webp)
@name        wordmark when there is no image, initials in a mark, and the accessible name
@variant?    'auto' | 'mark' | 'wordmark'   (default 'auto')
@size?       'xs' | 's' | 'm' | 'l' | 'xl'   (default 'm')
@decorative? hide it from assistive tech
```

**`@variant` is the shape.** `mark` is a square (the height is also the width) and `wordmark` is as wide as its content. `auto` reads the image's aspect ratio once it has loaded: wider than 5:4 is a wordmark, anything else a mark. Until it loads, and with no image, `auto` is a wordmark. A sidebar header passes `mark` while collapsed and `wordmark` while expanded.

**`@size` sets the height, not the width.** It sets the host `font-size` from the same `--pretui-size-*` ladder as Token and Autocomplete, and the height is `2em` of it, so one number scales the logo, its initials and its radius. The width follows the image. `--pretui-logo-h` sets any height for one instance.

**State is in `data-*`.** `data-variant` is the resolved shape (`mark` or `wordmark`), `data-size`, `data-has-image`, and `data-state='fallback'` after an image failed.

## Prior art

**Atlassian** ships `Logo` (and per-product logos) with `appearance` and `size`; the name is the one this kit borrowed. **Material UI**, **Ant Design** and **shadcn** have no logo component: the app puts an `<img>` in a slot, so cropping, sizing, the broken-image case and the accessible name are rebuilt in every app. Chakra and Mantine reach for **Avatar** and crop.

Where Pretui differs: the fallback is part of the component (name or initials, announced as the name), and `auto` removes the need for the caller to know the aspect ratio. Left out on purpose: no background tile behind an image (a logo that needs one is wrapped in **Card** or **Surface**), no link (wrap it in an `<a>`), and no image upload.

## Accessibility

- **The name comes from `@name`.** An image gets it as `alt`; a wordmark is its own text; a text mark (initials) is `role='img'` with `aria-label` set to the whole name, so a reader says "Acme Studio", not "AS".
- **`@decorative`** gives the image an empty `alt` and puts `aria-hidden='true'` on the host. Use it when text beside the logo already says the name, such as a heading, so the name is not read twice.
- A logo is exempt from the 3:1 non-text contrast rule (WCAG 1.4.11), and the image is the caller's. The text uses `--foreground`, and the initials tile `--foreground` on `--muted`; both pass WCAG 4.5:1 and APCA Lc 60 in the default theme, light and dark.
- A broken image falls back to text; the swap does not move focus or announce.

## Theming

Text: `--foreground`. Initials tile: `--muted` fill, `--border` hairline, `--radius` halved (`--pretui-logo-radius` overrides it). Type steps: `--pretui-size-*` over `--boxel-font-size-*`. The styles sit in `@layer PretComponent`, so a caller's unlayered CSS wins without a more specific selector. Knobs: `--pretui-logo-h` (height, default `2em`), `--pretui-logo-radius`.

## React ecosystem

| React agent                           | Pretui                                      |
| ------------------------------------- | ------------------------------------------- |
| `<img src alt className='h-8'>`       | `<Logo @src @name @size='l' />`             |
| `<Avatar src name shape='square'>`    | `<Logo>` when the image must not be cropped |
| `alt=''` / `aria-hidden` on a logo    | `@decorative={{true}}`                      |
| `<Logo variant='icon' \| 'wordmark'>` | `@variant='mark'` \| `'wordmark'`           |
