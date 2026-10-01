// Pretui — AspectRatio: a frame that reserves a ratio and fits its media (AspectBox is the same component).
import Component from '@glimmer/component';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';

// ── AspectRatio ──────────────────────────────────────────────────────────
//
// Sources read: radix-primitives/packages/react/aspect-ratio, shadcn
// aspect-ratio.tsx, mantine AspectRatio.
//
// Law 8 in one component — a value that arrives late reserves its space —
// and deliberately built to be the shared frame another agent asked for under
// the name `AspectBox`: Gallery, AssetWell, MediaPlayer, CopyFit and
// Skeleton all want the same box. It is exported under BOTH names at the
// bottom of this file so neither search misses.
//
// What is fixed relative to the sources:
//
//   1. **Radix and Chakra still ship the padding-bottom hack.** Radix wraps
//      the content in an opaque outer div with
//      `paddingBottom: 100 / ratio + '%'` and pins the inner element to
//      `top/right/bottom/left: 0` — physical, and written AFTER the
//      consumer's own `style` is spread, so position and offsets cannot be
//      changed at all. The wrapper accepts no className, no style, no ref, so
//      the box that actually has the size is unstyleable from outside except
//      through an undocumented data attribute. Chakra moves the same hack to
//      a `::before`. Both predate the `aspect-ratio` property; both cost an
//      element, break `object-fit` composition, and make height-driven
//      sizing ("fill this row, derive the width") impossible. This uses the
//      property: one element, composable with everything.
//      `100 / ratio` also yields `Infinity%` for `ratio = 0` in all of them,
//      unvalidated — a rejected ratio here just leaves the box at its
//      stylesheet default.
//   2. **`ratio` is a bare number upstream**, so `16/9` has to be evaluated
//      in JS and shows up in DevTools as `1.7777777777777777` with the
//      authoring intent gone. Here `@ratio` accepts either a number or the
//      CSS spelling (`'16 / 9'`), because that is what an agent will type,
//      and it reaches CSS through the kit's caller-value guard rather than
//      string interpolation.
//      Mantine does use the property, but sets `--ar-ratio` on the parent and
//      consumes it in `> :where(*:not(style))` — so one AspectRatio ratios
//      EVERY child, and at zero specificity. The frame here is the sized box
//      itself, so there is nothing to leak onto.
//   3. **No image handling at all upstream.** Radix frames whatever you put
//      in it, which means every consumer re-decides `<img>` vs
//      `background-image`, alt text and lazy loading — and most of them get
//      the accessible name wrong. The `@fit` split makes it one decision:
//      • `actual` renders a REAL `<img>` with the intrinsic `width`/`height`
//        attributes, `loading='lazy'`, `decoding='async'` and real `alt`.
//        This is the accessible default and the only mode that gives the
//        browser an aspect ratio before the bytes land.
//      • `contain` / `cover` paint a `background-image` on a `role='img'`
//        div — the right choice for art direction, where the image is a
//        surface rather than content.
//      **An empty alt drops `role='img'` entirely.** A `role='img'` with no
//      accessible name is a nameless landmark every screen reader announces
//      as "image" and nothing else; a decorative background is better off as
//      a plain div.
//   4. **`url()` is built here, never interpolated.** `cssValue` deliberately
//      rejects `url`, `:` and quotes, so this file owns a narrow URL guard
//      (`cssUrl` below) that parses the value with the platform's own `URL`
//      and emits a quoted `url("…")` only for a protocol on the allowlist.
//   5. **`object-fit` is hardcoded to `cover` by Mantine and Chakra** with no
//      escape short of overriding their rule; Radix does nothing at all, so
//      an image simply overflows unless the consumer remembers. Here it is
//      the `--pretui-aspect-object-fit` knob, defaulting to `cover`. And
//      Chakra's `Children.only` throws outright on `{loading ? null : …}` —
//      a conditional child is a hard runtime error. A block here can be
//      empty, one node, or many.

/**
 * Protocols an image may be fetched over. `javascript:` and `vbscript:` are
 * the obvious exclusions; `file:` is excluded because a realm card can never
 * legitimately reach one.
 */
const IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'data:', 'blob:']);

/** Characters that would break out of a quoted `url("…")` token, plus the
 * whitespace CSS would treat as a token boundary. A real URL encodes all of
 * these, so rejecting them costs nothing. */
const URL_FORBIDDEN = /["'\\()<>\s]/;

/** Longer than any legitimate src, including a modest inline data URI. */
const MAX_URL_LENGTH = 8192;

/**
 * Validate a caller-supplied image URL and return a quoted `url("…")` token,
 * or `undefined`. Allowlist, never a sanitiser — a value is passed through
 * whole or dropped whole, exactly like `cssValue` in `pretui-css.gts`.
 *
 * This lives here rather than in the shared guard because the shared guard is
 * deliberately hostile to `url()`: admitting it kit-wide would let every
 * `@hue`-shaped arg in the kit fetch a remote resource. Only a component that
 * is ABOUT an image should be able to write one.
 */
export function cssUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  let value = raw.trim();
  if (value.length === 0 || value.length > MAX_URL_LENGTH) {
    return undefined;
  }
  if (URL_FORBIDDEN.test(value)) {
    return undefined;
  }
  let parsed: URL;
  try {
    // A base is supplied so a relative path (`/photos/a.jpg`) resolves and can
    // be protocol-checked; the base itself is never emitted.
    parsed = new URL(value, 'https://pretui.invalid/');
  } catch {
    return undefined;
  }
  if (!IMAGE_PROTOCOLS.has(parsed.protocol)) {
    return undefined;
  }
  // A data: URI may only carry an image, so a `data:text/html` payload cannot
  // ride in through a `background-image` that some browser decides to honour.
  if (parsed.protocol === 'data:' && !value.startsWith('data:image/')) {
    return undefined;
  }
  return 'url("' + value + '")';
}

export type AspectFit = 'actual' | 'contain' | 'cover';

export interface AspectRatioSignature {
  Args: {
    /**
     * The ratio to reserve. A number (`1.7778`) or the CSS spelling
     * (`'16 / 9'`). Default `1`. Validated by the kit guard; a rejected value
     * leaves the box at `auto` rather than breaking the stylesheet.
     */
    ratio?: number | string;
    /**
     * `actual` (default) renders a real `<img>`; `contain` and `cover` paint a
     * `background-image` on a `role='img'` box. Ignored when there is no
     * `@src` and a `<:default>` block is supplied instead.
     */
    fit?: AspectFit;
    /** Image source. Omit to frame `<:default>` content instead. */
    src?: string;
    /**
     * The image's accessible name. An EMPTY or omitted alt means decorative:
     * `actual` keeps `alt=''` (the correct decorative `<img>`), and
     * `contain`/`cover` drop `role='img'` entirely rather than leave an
     * unnamed image role in the tree.
     */
    alt?: string;
    /** Intrinsic pixel width, for `actual`. Lets the browser reserve space. */
    width?: number;
    /** Intrinsic pixel height, for `actual`. */
    height?: number;
    /** `lazy` (default) or `eager`. */
    loading?: 'lazy' | 'eager';
    /** Ground colour behind a `contain` letterbox. Any kit-valid CSS colour. */
    background?: string;
    /** Corner radius. Any kit-valid CSS length. */
    radius?: string;
    /** Draw the kit hairline around the frame. */
    bordered?: boolean;
  };
  Blocks: {
    /** Arbitrary framed content — an iframe, a canvas, a chart, a map. */
    default: [];
  };
  Element: HTMLDivElement;
}

/**
 * A box that reserves its shape before its content arrives.
 *
 * ```hbs
 * <AspectRatio @ratio='16 / 9' @src={{this.photo}} @alt='Estate at dawn' />
 * <AspectRatio @ratio={{1}} @fit='cover' @src={{this.avatar}} @alt='' />
 * <AspectRatio @ratio='4 / 3'><MapView /></AspectRatio>
 * ```
 */
export class AspectRatio extends Component<AspectRatioSignature> {
  get fit(): AspectFit {
    return this.args.fit ?? 'actual';
  }
  /** `undefined` when the caller supplied nothing usable, so the stylesheet's
   * own `1` survives rather than the box collapsing. */
  private get ratioValue(): string | undefined {
    let raw = this.args.ratio;
    if (raw === undefined) {
      return undefined;
    }
    return typeof raw === 'number' ? String(raw) : raw;
  }
  get style() {
    return cssStyleFrom([
      cssDeclaration('--pretui-aspect-ratio', this.ratioValue),
      cssDeclaration('--pretui-aspect-bg', this.args.background),
      cssDeclaration('--pretui-aspect-radius', this.args.radius),
    ]);
  }
  /** The painted mode's own declaration — built here, from a guarded URL. */
  get paintedStyle() {
    let url = cssUrl(this.args.src);
    return cssStyleFrom([
      cssDeclaration('--pretui-aspect-ratio', this.ratioValue),
      cssDeclaration('--pretui-aspect-bg', this.args.background),
      cssDeclaration('--pretui-aspect-radius', this.args.radius),
      url === undefined ? undefined : 'background-image: ' + url,
    ]);
  }
  get alt(): string {
    return (this.args.alt ?? '').trim();
  }
  /**
   * An unnamed `role='img'` announces as a bare "image" and tells the reader
   * nothing, so a decorative painted frame drops the role and becomes an
   * ordinary div. This is the one line most ports of Radix get wrong.
   */
  get paintedRole(): string | undefined {
    return this.alt.length > 0 ? 'img' : undefined;
  }
  get loading(): 'lazy' | 'eager' {
    return this.args.loading ?? 'lazy';
  }
  get painted(): boolean {
    return this.fit !== 'actual';
  }

  <template>
    {{#if @src}}
      {{#if this.painted}}
        <div
          class='pretui-aspect'
          style={{this.paintedStyle}}
          data-fit={{this.fit}}
          data-bordered={{if @bordered 'true' 'false'}}
          role={{this.paintedRole}}
          aria-label={{if this.paintedRole this.alt}}
          data-test-pretui-aspect-ratio
          ...attributes
        ></div>
      {{else}}
        <div
          class='pretui-aspect'
          style={{this.style}}
          data-fit='actual'
          data-bordered={{if @bordered 'true' 'false'}}
          data-test-pretui-aspect-ratio
          ...attributes
        >
          <img
            class='pretui-aspect-img'
            src={{@src}}
            alt={{this.alt}}
            width={{@width}}
            height={{@height}}
            loading={{this.loading}}
            decoding='async'
          />
        </div>
      {{/if}}
    {{else}}
      <div
        class='pretui-aspect'
        style={{this.style}}
        data-fit='slot'
        data-bordered={{if @bordered 'true' 'false'}}
        data-test-pretui-aspect-ratio
        ...attributes
      >
        {{yield}}
      </div>
    {{/if}}

    <style scoped>
      .pretui-aspect {
        /* The property, not the padding-bottom hack: one element, composable
           with object-fit, and `min-block-size` still works on it. */
        aspect-ratio: var(--pretui-aspect-ratio, 1);
        inline-size: 100%;
        min-inline-size: 0;
        overflow: hidden;
        border-radius: var(--pretui-aspect-radius, var(--radius));
        background-color: var(
          --pretui-aspect-bg,
          color-mix(in oklch, var(--foreground) 6%, var(--card))
        );
        background-position: center;
        background-repeat: no-repeat;
        box-sizing: border-box;
      }
      /* A slot frame is a single-cell grid, so a yielded child stretches to
         the box without this component styling the caller's element — which
         the scoped-CSS transpiler would not let it do anyway. */
      .pretui-aspect[data-fit='slot'] {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
      }
      .pretui-aspect[data-fit='contain'] {
        background-size: contain;
      }
      .pretui-aspect[data-fit='cover'] {
        background-size: cover;
      }
      .pretui-aspect[data-bordered='true'] {
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .pretui-aspect-img {
        display: block;
        inline-size: 100%;
        block-size: 100%;
        object-fit: var(--pretui-aspect-object-fit, cover);
      }
    </style>
  </template>
}

/**
 * `AspectBox` is the same component under the name the foundation review asked
 * for. One implementation, two entry points: an agent trained on Radix types
 * `AspectRatio`, an agent reading the Pretui foundation notes types
 * `AspectBox`, and neither gets a second frame.
 */
export const AspectBox = AspectRatio;
