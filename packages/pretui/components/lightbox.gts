// Pretui — Lightbox: a full-screen image gallery on PhotoSwipe.
//
//   <Lightbox @assets={{assets}} />
//
// Renders a thumbnail gallery; opening a tile hands the whole set to
// PhotoSwipe 5.4.4 (MIT, vendored at ./photoswipe) for pinch-zoom, pan,
// keyboard navigation and a real modal dialog.
//
// Three decisions worth stating:
//
//   1. **The gallery is anchors, not buttons.** PhotoSwipe binds to
//      `<a href>` children, and that choice pays twice: the markup degrades to
//      "open the file" with no JavaScript at all, and the tile is reachable,
//      focusable, middle-clickable and copy-link-able for free. A grid of
//      `<div onclick>` — which is what most lightbox demos ship — has none of
//      that. Realm lint would also reject a `<button>` in some of the places
//      this ends up nested.
//   2. **The stylesheet is refcounted, not module-installed.** PhotoSwipe
//      appends its root to `document.body`, outside every component subtree,
//      so scoped CSS cannot reach it and a side-effect `.css` import breaks
//      realm indexing (Appendix M.3). The CSS therefore travels as a string in
//      `photoswipe/style.ts` and is installed into `document.head` by the
//      FIRST Lightbox and removed by the LAST — a module-level "install once"
//      flag would leak a stylesheet across test modules, which is exactly the
//      kind of cross-file coupling that makes one test's failure depend on
//      another's.
//   3. **The engine lives in a modifier and only in a modifier.** The rAF
//      ruling: `new PhotoSwipeLightbox(...)` happens in the modifier body,
//      `destroy()` in its destructor. Nothing constructs it in a getter, where
//      the indexer could evaluate it outside a browser.
//
// BETTER THAN THE INSPIRATION: PhotoSwipe's own docs mount the gallery with a
// hand-written `<a>` per image and hard-coded `data-pswp-width`. Here the
// dimensions come off the same `MediaAssetSpec` the rest of the media
// territory already carries, the tile reserves that exact aspect ratio before
// a byte arrives (the Law-8 corollary), and an asset with no dimensions is
// named as such rather than silently mis-sized.
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import { PhotoSwipe, PhotoSwipeLightbox } from '../photoswipe/index.js';
import { PHOTOSWIPE_CSS, PSWP_THEME_CSS } from '../photoswipe/style';
import type { MediaAssetSpec, ResolvedMediaAsset } from '../internal/media-viewer';
import { resolveAsset } from '../internal/media-viewer';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { EmptyState } from './empty-state';

// ── The refcounted stylesheet ────────────────────────────────────────────

const STYLE_ID = 'pretui-photoswipe-css';
let styleRefs = 0;

/** Install the vendored stylesheet on first use. Returns a release function;
 * the last release removes the element again. Idempotent against a host that
 * already installed it under the same id. */
export function acquirePhotoSwipeStyles(): () => void {
  let released = false;
  if (typeof document === 'undefined') {
    return () => undefined;
  }
  styleRefs = styleRefs + 1;
  if (styleRefs === 1 && !document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = PHOTOSWIPE_CSS + '\n' + PSWP_THEME_CSS;
    document.head.appendChild(style);
  }
  return () => {
    if (released) {
      return;
    }
    released = true;
    styleRefs = Math.max(0, styleRefs - 1);
    if (styleRefs === 0) {
      document.getElementById(STYLE_ID)?.remove();
    }
  };
}

// ── The item model ───────────────────────────────────────────────────────

/** What a gallery tile needs, derived once at the component. */
export interface LightboxItem {
  asset: ResolvedMediaAsset;
  /** The full-size URL PhotoSwipe opens. */
  src: string;
  /** The thumbnail URL, which may be the same file. */
  thumb: string;
  /** Always a number: PhotoSwipe needs one, so an unknown size is filled in
   * from `FALLBACK` and flagged on the element rather than guessed silently. */
  width: number;
  height: number;
  /** True when the dimensions above were assumed, not given. */
  assumed: boolean;
  alt: string;
  ratio: string;
  index: number;
  /** "3 of 8" — the accessible name of the tile's link. */
  position: string;
}

/** Used only when a caller gives no dimensions. 4:3 is the least-wrong
 * default for a mixed shelf, and `assumed` records that we guessed. */
const FALLBACK_WIDTH = 1600;
const FALLBACK_HEIGHT = 1200;

/** Is this asset something a lightbox can actually open? */
export function isLightboxable(asset: ResolvedMediaAsset): boolean {
  return asset.kind === 'image';
}

function toItem(
  spec: MediaAssetSpec,
  index: number,
  total: number,
): LightboxItem {
  const asset = resolveAsset(spec);
  const known = Boolean(asset.width && asset.height);
  const width = known ? (asset.width as number) : FALLBACK_WIDTH;
  const height = known ? (asset.height as number) : FALLBACK_HEIGHT;
  return {
    asset,
    src: asset.src,
    thumb: asset.thumbnail ?? asset.poster ?? asset.src,
    width,
    height,
    assumed: !known,
    alt: asset.alt ?? asset.label,
    ratio: `${width} / ${height}`,
    index,
    position: `${asset.label} — image ${index + 1} of ${total}`,
  };
}

// ── The engine modifier ──────────────────────────────────────────────────

/** Everything the modifier needs, read once at setup. Kept as an interface so
 * the component and the modifier cannot drift. */
export interface LightboxEngineHost {
  captionFor: (index: number) => string;
  handleOpen: (index: number) => void;
  handleChange: (index: number) => void;
  handleClose: () => void;
  loop: boolean;
  counter: boolean;
  zoom: boolean;
  bgOpacity: number;
}

/**
 * Own one `PhotoSwipeLightbox` for the life of the gallery element.
 *
 * The second positional is a plain string key: when any option that PhotoSwipe
 * reads at construction time changes, the key changes, ember-modifier tears
 * this down and it is rebuilt. That is deliberate and cheap — PhotoSwipe reads
 * its options once and has no setter for most of them, so pretending they are
 * live would be a lie.
 */
const photoswipeGallery = modifier(
  (el: HTMLElement, [host, _key]: [LightboxEngineHost, string]) => {
    const releaseStyles = acquirePhotoSwipeStyles();
    // Law 5: consent before motion. Read once — a media-query listener here
    // would be a subscription with nothing to gain, since the engine is
    // rebuilt whenever its key changes anyway.
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const lightbox = new PhotoSwipeLightbox({
      gallery: el,
      children: 'a.pretui-lb-link',
      pswpModule: PhotoSwipe,
      loop: host.loop,
      counter: host.counter,
      zoom: host.zoom,
      bgOpacity: host.bgOpacity,
      // PhotoSwipe's default. Stated rather than inherited, because "focus
      // returns to the thumbnail that opened it" is a dialog-pattern
      // requirement, not a nicety.
      returnFocus: true,
      arrowKeys: true,
      escKey: true,
      // Reduced motion lands on the END state (Law 5), which for a lightbox
      // means it simply appears rather than zooming out of the thumbnail.
      showHideAnimationType: reduced ? 'none' : 'zoom',
      zoomAnimationDuration: reduced ? 0 : 333,
    });

    // A caption rendered from the asset's own alt text. PhotoSwipe's caption
    // plugin is a separate package; this is four lines and needs no vendoring.
    lightbox.on('uiRegister', () => {
      lightbox.pswp?.ui?.registerElement({
        name: 'pretui-caption',
        order: 9,
        isButton: false,
        appendTo: 'root',
        onInit: (node: HTMLElement) => {
          node.className = 'pretui-pswp-caption';
          const paint = () => {
            const index = lightbox.pswp?.currIndex ?? 0;
            // textContent, never innerHTML: the caption is caller data.
            node.textContent = host.captionFor(index);
          };
          lightbox.pswp?.on('change', paint);
          paint();
        },
      });
    });

    lightbox.on('change', () => host.handleChange(lightbox.pswp?.currIndex ?? 0));
    lightbox.on('afterInit', () => host.handleOpen(lightbox.pswp?.currIndex ?? 0));
    lightbox.on('close', () => host.handleClose());

    lightbox.init();

    return () => {
      // Closes any open viewer, removes the delegated listener, drops the DOM
      // and — because PhotoSwipe removes its own <html> class on close — never
      // strands page scroll.
      lightbox.destroy();
      releaseStyles();
    };
  },
);

// ── Lightbox ─────────────────────────────────────────────────────────────

export interface LightboxSignature {
  Args: {
    /** The gallery. Non-image assets are dropped, and the component says how
     * many it dropped rather than pretending the set was smaller. */
    assets: readonly MediaAssetSpec[];
    /** Fixed column count. Omit for a responsive `auto-fill` grid. */
    columns?: number;
    /** Minimum tile width for the responsive grid. Default `160px`. */
    minTile?: string;
    /** Gap between tiles. Default `10px`. */
    gap?: string;
    /** Wrap from the last image to the first. Default `true`. */
    loop?: boolean;
    /** Show PhotoSwipe's "3 / 8" counter. Default `true`. */
    counter?: boolean;
    /** Offer the zoom button. Default `true`. */
    zoom?: boolean;
    /** Backdrop opacity, 0–1. Default `1`. */
    bgOpacity?: number;
    /** Caption for the open image. Defaults to its alt text. */
    caption?: (asset: ResolvedMediaAsset) => string;
    onOpen?: (index: number, asset: ResolvedMediaAsset) => void;
    onChange?: (index: number, asset: ResolvedMediaAsset) => void;
    onClose?: () => void;
  };
  Blocks: {
    /** Replaces the built-in empty state. */
    empty: [];
  };
  Element: HTMLDivElement;
}

export class Lightbox extends Component<LightboxSignature> implements LightboxEngineHost {
  get items(): LightboxItem[] {
    const all = this.args.assets ?? [];
    const images = all.map((a) => resolveAsset(a)).filter(isLightboxable);
    return images.map((asset, i) => toItem(asset, i, images.length));
  }
  get skipped(): number {
    return (this.args.assets?.length ?? 0) - this.items.length;
  }
  get skippedNote(): string {
    const n = this.skipped;
    return n === 1
      ? '1 asset is not an image and is not in this gallery.'
      : `${n} assets are not images and are not in this gallery.`;
  }
  get loop(): boolean {
    return this.args.loop ?? true;
  }
  get counter(): boolean {
    return this.args.counter ?? true;
  }
  get zoom(): boolean {
    return this.args.zoom ?? true;
  }
  get bgOpacity(): number {
    const raw = this.args.bgOpacity;
    return typeof raw === 'number' && raw >= 0 && raw <= 1 ? raw : 1;
  }
  /** Every construction-time option, flattened. Changing any of them rebuilds
   * the engine, which is the honest behaviour — PhotoSwipe reads them once. */
  get engineKey(): string {
    return [this.loop, this.counter, this.zoom, this.bgOpacity, this.items.length].join(':');
  }
  get gridStyle() {
    const columns =
      typeof this.args.columns === 'number' && this.args.columns > 0
        ? `repeat(${Math.round(this.args.columns)}, minmax(0, 1fr))`
        : undefined;
    return cssStyleFrom([
      cssDeclaration('--pretui-lb-columns', columns),
      cssDeclaration('--pretui-lb-min', this.args.minTile),
      cssDeclaration('--pretui-lb-gap', this.args.gap),
    ]);
  }

  tileStyle = (item: LightboxItem) => {
    return cssStyleFrom([cssDeclaration('--pretui-lb-ratio', item.ratio)]);
  };

  captionFor = (index: number): string => {
    const item = this.items[index];
    if (!item) {
      return '';
    }
    return this.args.caption ? this.args.caption(item.asset) : item.alt;
  };
  handleOpen = (index: number): void => {
    const item = this.items[index];
    if (item) {
      this.args.onOpen?.(index, item.asset);
    }
  };
  handleChange = (index: number): void => {
    const item = this.items[index];
    if (item) {
      this.args.onChange?.(index, item.asset);
    }
  };
  handleClose = (): void => {
    this.args.onClose?.();
  };

  <template>
    <div class='pretui-lb' data-test-pretui-lightbox ...attributes>
      {{#if this.items}}
        <div
          class='pretui-lb-grid'
          style={{this.gridStyle}}
          {{photoswipeGallery this this.engineKey}}
        >
          {{#each this.items key='src' as |item|}}
            <a
              class='pretui-lb-link'
              href={{item.src}}
              target='_blank'
              rel='noopener noreferrer'
              data-pswp-width={{item.width}}
              data-pswp-height={{item.height}}
              data-assumed-size={{if item.assumed 'true'}}
              aria-label={{item.position}}
              style={{this.tileStyle item}}
            >
              <img
                class='pretui-lb-thumb'
                src={{item.thumb}}
                alt={{item.alt}}
                loading='lazy'
                decoding='async'
              />
            </a>
          {{/each}}
        </div>
        {{#if this.skipped}}
          <p class='pretui-lb-note'>{{this.skippedNote}}</p>
        {{/if}}
      {{else if (has-block 'empty')}}
        {{yield to='empty'}}
      {{else}}
        <EmptyState @title='No images to show' @texture={{false}}>
          <:default>
            A lightbox opens images. Hand it assets whose kind resolves to
            <code>image</code>.
          </:default>
        </EmptyState>
      {{/if}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-lb {
          --pretui-lb-columns: repeat(
            auto-fill,
            minmax(var(--pretui-lb-min, 160px), 1fr)
          );
          --pretui-lb-gap: 10px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }
        .pretui-lb-grid {
          display: grid;
          grid-template-columns: var(--pretui-lb-columns);
          gap: var(--pretui-lb-gap);
          min-width: 0;
        }
        .pretui-lb-link {
          display: block;
          position: relative;
          /* Reserved BEFORE the bytes arrive. Every tile keeps its own
             intrinsic ratio, so the grid does not reflow as images land. */
          aspect-ratio: var(--pretui-lb-ratio, 4 / 3);
          overflow: hidden;
          border-radius: var(--radius);
          background: color-mix(
            in oklch,
            var(--foreground) 6%,
            var(--card)
          );
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        .pretui-lb-link:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-lb-thumb {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        /* A tile whose size we had to assume carries a visible corner mark as
           well as the data attribute — state is never one channel only. */
        .pretui-lb-link[data-assumed-size='true']::after {
          content: '?';
          position: absolute;
          inset-block-end: 4px;
          inset-inline-end: 4px;
          min-width: 15px;
          padding: 0 4px;
          border-radius: 999px;
          font-size: var(--text-ui-xs, 10.5px);
          line-height: 15px;
          text-align: center;
          color: var(--pretui-on-neutral, var(--boxel-light));
          background: color-mix(in oklch, var(--foreground) 70%, transparent);
        }
        .pretui-lb-note {
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-lb-link {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
