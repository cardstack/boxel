## What it is

A box that **reserves its shape before its content arrives**. It is Law 8 as a component: a value that arrives late never shifts the layout around it. Give it a ratio and either an image (`@src`) or arbitrary content (an iframe, a map, a chart, a canvas) in its block. **AspectBox** is the same component under a second name, not a second frame.

Reach for a neighbour instead when one fits better:

- **ImageFrame** is the kit's opinionated photo treatment.
- **Image** adds a load fallback and a preview to a framed image.
- **Skeleton** is the placeholder while there is nothing to frame yet.
- **MediaPlayer** owns video and audio chrome.

AspectRatio is the plain frame all of them can sit in.

## The contract

```
@ratio? (number or CSS spelling like '16 / 9'; default 1)
@src?, @alt?, @fit? ('actual' | 'contain' | 'cover'; default 'actual')
@width?, @height?, @loading? ('lazy' | 'eager'; default 'lazy')
@background?, @radius?, @bordered?
<:default>   — framed content, used when @src is absent
Element: HTMLDivElement
```

**One element, sized by the `aspect-ratio` property.** There is no padding-bottom hack and no inner absolutely-positioned wrapper. The frame is the sized box, so `...attributes`, `min-block-size` and height-driven sizing all work on it. The block form is a single-cell grid, so a yielded child stretches to fill the frame without the component styling the caller's element.

**The ratio keeps its spelling.** `@ratio='16 / 9'` reaches CSS as `16 / 9`, not a pre-divided float, and a number is accepted too. Both pass through the kit's caller-value guard. A rejected value leaves the stylesheet default of `1` rather than breaking the box.

**`@fit` is the image decision, made once.**

- `actual` renders a real `<img>` with `alt`, the intrinsic `@width` / `@height` attributes, `loading` and `decoding='async'`. It is the accessible default, and the only mode that lets the browser know the ratio before the bytes land.
- `contain` and `cover` paint a `background-image` instead. That suits art direction, where the image is a surface rather than content.

**`@src` is guarded, never interpolated.** The painted modes build `url("…")` through `cssUrl`. It parses the value with the platform `URL`, admits only `http:`, `https:`, `blob:` and `data:image/`, and rejects quotes, brackets and whitespace. A value either passes through whole or is dropped whole. It is exported for any other component that is about an image.

`@background` sets the letterbox ground behind `contain`, `@radius` the corner radius, and `@bordered` draws the kit hairline.

## Prior art

**Radix / shadcn AspectRatio** and **Chakra** still use the padding-bottom hack. Radix wraps the content in an unstyleable outer div and pins the inner one with physical offsets written after the caller's style, so position cannot be changed at all. A `ratio` of `0` yields `Infinity%`. **Mantine** uses the property, but sets it on the parent and applies it to every child at zero specificity, so one AspectRatio ratios all of its children. All of them take `ratio` as a bare number, so `16/9` shows up in DevTools as `1.7777777777777777`.

Where Pretui is better: **one element and a real property**; **the ratio keeps its authoring spelling**; **image handling is built in**, with the `<img>` vs painted choice, accessible naming and lazy loading decided in one place instead of by every consumer; and **`object-fit` is a knob** (`--pretui-aspect-object-fit`, default `cover`) instead of hardcoded as in Mantine and Chakra. A block can be empty, one node or many, where Chakra's `Children.only` throws on a conditional child.

Where it is thinner: **no `asChild`**. The frame is always a `div`, so framing a link means putting the link inside. There is **no `srcset` / `sizes`** for the `actual` image, and **no load or error state**. A broken `@src` shows the ground colour. **Image** covers fallback and preview.

## Accessibility

No APG pattern. A frame is layout, and it carries no role unless it is itself the image.

- **`actual` is a real `<img>` with real `alt`.** The frame around it carries no role, so the image is announced once. The tests assert both.
- **A named painted frame is `role="img"` with `aria-label` from `@alt`**, and it has no `<img>` inside. The tests assert the role, the name and the absence of an `img`.
- **An empty or whitespace-only `@alt` means decorative.** `actual` keeps `alt=""`, which is the correct decorative `<img>`. The painted modes drop `role="img"` entirely instead of leaving an unnamed image role that announces as a bare "image". The tests assert both the empty and the whitespace case.
- **What `alt` says is the caller's job.** Describe the image's purpose in context. Leave it empty only when the image adds nothing that the surrounding text lacks.
- **Framed content keeps its own semantics.** An iframe in the block still needs its own `title`.

## Theming

`--pretui-aspect-ratio` (set from `@ratio`, default `1`), `--pretui-aspect-bg` (set from `@background`; the default is `--foreground` mixed 6% into `--card`), `--pretui-aspect-radius` (set from `@radius`, default `--radius`), `--pretui-aspect-object-fit` (the `actual` image's fit, default `cover`) and `--pretui-shadow-hairline` for `@bordered`, falling back to a 1px `--border` ring.

A season changes the empty-frame ground and the corner through `--card`, `--foreground` and `--radius`. Everything else is geometry, and that is fixed: full inline size, `min-inline-size: 0`, and clipped overflow.

## React ecosystem

| Agent types                          | Give them                                  |
| ------------------------------------ | ------------------------------------------ |
| `<AspectRatio ratio={16 / 9}>`       | `@ratio='16 / 9'` (or the number)          |
| `asChild`                            | `...attributes` on the frame; no `asChild` |
| `<AspectRatio><img/></AspectRatio>`  | `@src` + `@alt` (`@fit='actual'`)          |
| `<img style={{objectFit: 'cover'}}>` | `@fit='cover'` or the object-fit token     |
| AspectBox (foundation name)          | the same component                         |
