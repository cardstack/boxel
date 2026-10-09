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
//      realm indexing. The CSS therefore travels as a string in
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
import { resolveAsset, safeHref } from '../internal/media-viewer';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { EmptyState } from './empty-state';

// ── The refcounted stylesheet ────────────────────────────────────────────

/** The filmstrip and save button live in PhotoSwipe's root, outside every
 * component subtree, so their CSS travels with the refcounted sheet. They
 * hide with the rest of the chrome when a tap toggles the UI off. */
const VIEWER_EXTRAS_CSS = String.raw`
.pretui-pswp-filmstrip {
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  display: flex;
  gap: 4px;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  overflow-x: auto;
  scrollbar-width: none;
  scroll-padding-inline: 50%;
  background: linear-gradient(to top, rgb(0 0 0 / 0.55), transparent);
  transition: opacity 0.25s ease;
}
.pretui-pswp-filmstrip::-webkit-scrollbar {
  display: none;
}
.pretui-pswp-thumb {
  flex: none;
  inline-size: 44px;
  block-size: 56px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  overflow: hidden;
  background: rgb(255 255 255 / 0.08);
  opacity: 0.55;
  cursor: pointer;
  transition: opacity 0.2s ease, inline-size 0.2s ease;
}
.pretui-pswp-thumb img {
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
  display: block;
}
.pretui-pswp-thumb[aria-current='true'] {
  inline-size: 74px;
  opacity: 1;
  box-shadow: 0 0 0 2px #fff;
}
.pretui-pswp-thumb:focus-visible {
  outline: 2px solid var(--ring, #5b7cfa);
  outline-offset: 2px;
}
.pswp:not(.pswp--ui-visible) .pretui-pswp-filmstrip {
  opacity: 0;
  pointer-events: none;
}
.pretui-pswp-save {
  display: grid;
  place-items: center;
  color: var(--pswp-icon-color);
}
.pretui-pswp-save svg {
  inline-size: 22px;
  block-size: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
@media (prefers-reduced-motion: reduce) {
  .pretui-pswp-filmstrip,
  .pretui-pswp-thumb {
    transition: none;
  }
}
`;

const STYLE_ID = 'pretui-photoswipe-css';
let styleRefs = 0;
/** the element this module installed; a host-owned sheet is never removed */
let ownStyle: HTMLStyleElement | undefined;

/** Install the vendored stylesheet on first use. Returns a release function;
 * the last release removes the element again, but only one this module
 * created: a host that installed it under the same id keeps it. */
export function acquirePhotoSwipeStyles(): () => void {
  let released = false;
  if (typeof document === 'undefined') {
    return () => undefined;
  }
  styleRefs = styleRefs + 1;
  if (styleRefs === 1 && !document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      PHOTOSWIPE_CSS + '\n' + PSWP_THEME_CSS + '\n' + VIEWER_EXTRAS_CSS;
    document.head.appendChild(style);
    ownStyle = style;
  }
  return () => {
    if (released) {
      return;
    }
    released = true;
    styleRefs = Math.max(0, styleRefs - 1);
    if (styleRefs === 0 && ownStyle) {
      ownStyle.remove();
      ownStyle = undefined;
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
  /** Responsive candidates for the tile, chosen by `@thumbnailSizes`. */
  thumbSrcset?: string;
  /** Responsive candidates for the open image; PhotoSwipe sizes them to the
   * width it displays, so a phone never downloads the desktop file. */
  srcset?: string;
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

/** A gallery image: a media asset plus the responsive sources a tile and the
 * viewer choose from. Each is a plain `srcset` string (`url 480w, url 960w`). */
export interface LightboxAsset extends MediaAssetSpec {
  /** Candidates for the open image, alongside `src`. */
  srcset?: string;
  /** Candidates for the tile, alongside `thumbnail`. */
  thumbnailSrcset?: string;
}

function toItem(
  spec: LightboxAsset,
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
    thumbSrcset: spec.thumbnailSrcset,
    srcset: spec.srcset,
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

/** PhotoSwipe's own view of a viewer's lifecycle, which its types omit. */
interface PhotoSwipeLifecycle {
  isDestroying?: boolean;
  opener?: { isOpen?: boolean };
  close: () => void;
  destroy: () => void;
}

/**
 * Close a viewer whatever state it is in. PhotoSwipe's close() is a no-op
 * until the opening zoom has finished, and its destroy() only routes through
 * close(), so a viewer that is still opening could neither be dismissed nor
 * torn down. Returns true when it was torn down at once rather than animated.
 */
function dismissViewer(pswp: unknown): boolean {
  const viewer = pswp as PhotoSwipeLifecycle;
  if (viewer.opener?.isOpen) {
    viewer.close();
    return false;
  }
  viewer.isDestroying = true;
  viewer.destroy();
  return true;
}

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
  filmstrip: boolean;
  download: boolean;
  thumbFor: (index: number) => string;
  thumbSrcsetFor: (index: number) => string | undefined;
  srcFor: (index: number) => string;
  labelFor: (index: number) => string;
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
      // Keep the photo clear of the filmstrip rather than under it.
      ...(host.filmstrip
        ? { paddingFn: () => ({ top: 0, bottom: 80, left: 0, right: 0 }) }
        : {}),
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

      // Save: a real link with `download`, so the browser's own save path
      // (and a long-press "Save to Photos" on iOS) applies.
      if (host.download) {
        lightbox.pswp?.ui?.registerElement({
          name: 'pretui-save',
          order: 8,
          isButton: true,
          tagName: 'a',
          title: 'Save photo',
          html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
          onInit: (node: HTMLElement) => {
            const link = node as HTMLAnchorElement;
            link.classList.add('pretui-pswp-save');
            link.setAttribute('download', '');
            link.setAttribute('aria-label', 'Save photo');
            const point = () => {
              const index = lightbox.pswp?.currIndex ?? 0;
              link.href = host.srcFor(index);
            };
            lightbox.pswp?.on('change', point);
            point();
          },
        });
      }

      // Filmstrip: every photo in the set, the current one wider and lit,
      // kept centred as the reader swipes. A row of buttons, so the keyboard
      // reaches it too.
      if (host.filmstrip) {
        lightbox.pswp?.ui?.registerElement({
          name: 'pretui-filmstrip',
          order: 10,
          isButton: false,
          appendTo: 'root',
          onInit: (node: HTMLElement) => {
            const pswp = lightbox.pswp;
            if (!pswp) {
              return;
            }
            node.className = 'pretui-pswp-filmstrip';
            node.setAttribute('role', 'group');
            node.setAttribute('aria-label', 'All photos');
            const total = pswp.getNumItems();
            const buttons: HTMLButtonElement[] = [];
            for (let i = 0; i < total; i++) {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = 'pretui-pswp-thumb';
              button.setAttribute('aria-label', host.labelFor(i));
              const img = document.createElement('img');
              img.alt = '';
              img.loading = 'lazy';
              img.decoding = 'async';
              // sizes and srcset before src, so the browser picks once
              const srcset = host.thumbSrcsetFor(i);
              if (srcset) {
                img.sizes = '88px';
                img.srcset = srcset;
              }
              img.src = host.thumbFor(i);
              button.appendChild(img);
              button.addEventListener('click', () => pswp.goTo(i));
              node.appendChild(button);
              buttons.push(button);
            }
            const sync = () => {
              const current = pswp.currIndex;
              buttons.forEach((b, i) =>
                b.setAttribute('aria-current', i === current ? 'true' : 'false'),
              );
              buttons[current]?.scrollIntoView({
                block: 'nearest',
                inline: 'center',
                behavior: reduced ? 'auto' : 'smooth',
              });
            };
            pswp.on('change', sync);
            sync();
          },
        });
      }
    });

    // Escape belongs to the open viewer. Caught at the window in the capture
    // phase, so a host that also binds Escape on the document (Boxel's card
    // stack closes the card) never sees the keypress that closed a photo.
    const escapeFirst = (event: KeyboardEvent) => {
      const pswp = lightbox.pswp;
      if (event.key !== 'Escape' || !pswp) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      // An animated close reports through the 'close' event; a viewer torn
      // down mid-opening never dispatches it, so report it here.
      if (dismissViewer(pswp)) {
        host.handleClose();
      }
    };
    lightbox.on('afterInit', () =>
      window.addEventListener('keydown', escapeFirst, true),
    );
    lightbox.on('destroy', () =>
      window.removeEventListener('keydown', escapeFirst, true),
    );

    lightbox.on('change', () => host.handleChange(lightbox.pswp?.currIndex ?? 0));
    lightbox.on('afterInit', () => host.handleOpen(lightbox.pswp?.currIndex ?? 0));
    lightbox.on('close', () => host.handleClose());

    lightbox.init();

    return () => {
      // Closes any open viewer, removes the delegated listener, drops the DOM
      // and — because PhotoSwipe removes its own <html> class on close — never
      // strands page scroll.
      // A viewer still opening (or mid-close) would survive lightbox.destroy()
      // and strand its root, focus trap and window.pswp; tear it down first.
      if (lightbox.pswp) {
        const viewer = lightbox.pswp as unknown as PhotoSwipeLifecycle;
        viewer.isDestroying = true;
        viewer.destroy();
      }
      lightbox.destroy();
      releaseStyles();
    };
  },
);

// ── Lightbox ─────────────────────────────────────────────────────────────

/** One chapter of a sectioned gallery. */
export interface LightboxSection {
  title?: string;
  caption?: string;
  assets: readonly LightboxAsset[];
}

/** A section as rendered: its tiles carry indices into the WHOLE set. */
export interface LightboxGroup {
  section: LightboxSection;
  index: number;
  items: LightboxItem[];
}

export interface LightboxSignature {
  Args: {
    /** The gallery. Non-image assets are dropped, and the component says how
     * many it dropped rather than pretending the set was smaller. */
    assets?: readonly LightboxAsset[];
    /** The gallery in chapters: one grid per section, but ONE viewer over
     * the whole set, so a swipe carries on from one chapter into the next.
     * Use instead of `@assets`. Headed by `<:section>`, or by a default
     * title and caption. */
    sections?: readonly LightboxSection[];
    /** A thumbnail strip along the bottom of the open viewer, for jumping
     * through a long set. Default `false`. */
    filmstrip?: boolean;
    /** A save button in the viewer's toolbar that downloads the open
     * photo's full-size file. Default `false`. */
    download?: boolean;
    /** Fixed column count. Omit for a responsive `auto-fill` grid. */
    columns?: number;
    /** Minimum tile width for the responsive grid. Default `160px`. */
    minTile?: string;
    /** Gap between tiles. Default `10px`. */
    gap?: string;
    /** `'grid'` (default) puts tiles in columns, each at its own ratio, so a
     * portrait tile makes its row taller. `'justified'` lays tiles in rows
     * that share one height and fill the width edge to edge, uncropped (the
     * Google Photos / Flickr layout), which suits mixed orientations. */
    layout?: 'grid' | 'justified';
    /** Target row height for the justified layout; rows stretch from it to
     * fill the width. Default `clamp(96px, 16vw, 200px)`. */
    rowHeight?: string;
    /** The `sizes` for tiles that carry a `thumbnailSrcset`: how wide a tile
     * is drawn, so the browser fetches the smallest candidate that stays
     * sharp. Default `auto, (max-width: 600px) 50vw, 25vw`; `auto` lets a
     * browser that supports it measure the lazy tile itself. */
    thumbnailSizes?: string;
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
    /** Heads each section when `@sections` is used. */
    section: [LightboxSection, number];
  };
  Element: HTMLDivElement;
}

export class Lightbox extends Component<LightboxSignature> implements LightboxEngineHost {
  get sections(): readonly LightboxSection[] {
    return this.args.sections ?? [{ assets: this.args.assets ?? [] }];
  }
  get sectioned(): boolean {
    return Boolean(this.args.sections);
  }
  /** One pass over every section, so tile indices run across the whole set
   * and the single viewer can swipe from one chapter into the next. */
  get groups(): LightboxGroup[] {
    // an image whose src could run script never becomes a link
    const usable = (assets: readonly LightboxAsset[]) =>
      assets
        .map((a) => resolveAsset(a) as ResolvedMediaAsset & LightboxAsset)
        .filter(isLightboxable)
        .filter((a) => safeHref(a.src, { images: true }) !== undefined);
    const perSection = this.sections.map((section) => usable(section.assets ?? []));
    const total = perSection.reduce((n, list) => n + list.length, 0);
    let offset = 0;
    return this.sections.map((section, index) => {
      const items = perSection[index]!.map((asset, i) =>
        toItem(asset, offset + i, total),
      );
      offset += items.length;
      return { section, index, items };
    });
  }
  get items(): LightboxItem[] {
    return this.groups.flatMap((g) => g.items);
  }
  get skipped(): number {
    const given = this.sections.reduce((n, s) => n + (s.assets?.length ?? 0), 0);
    return given - this.items.length;
  }
  get filmstrip(): boolean {
    return this.args.filmstrip ?? false;
  }
  get download(): boolean {
    return this.args.download ?? false;
  }
  thumbFor = (index: number): string => this.items[index]?.thumb ?? '';
  thumbSrcsetFor = (index: number): string | undefined => this.items[index]?.thumbSrcset;
  get thumbnailSizes(): string {
    return this.args.thumbnailSizes ?? 'auto, (max-width: 600px) 50vw, 25vw';
  }
  srcFor = (index: number): string => this.items[index]?.src ?? '';
  labelFor = (index: number): string => this.items[index]?.position ?? '';
  get skippedNote(): string {
    const n = this.skipped;
    return n === 1
      ? '1 asset is not a linkable image and is not in this gallery.'
      : `${n} assets are not linkable images and are not in this gallery.`;
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
    return [
      this.loop,
      this.counter,
      this.zoom,
      this.bgOpacity,
      this.filmstrip,
      this.download,
      this.items.length,
    ].join(':');
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
      cssDeclaration('--pretui-lb-row', this.args.rowHeight),
    ]);
  }
  get layout(): 'grid' | 'justified' {
    return this.args.layout === 'justified' ? 'justified' : 'grid';
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
        {{! ONE engine over every section: PhotoSwipe collects the links in
            document order, so their indices match the items across the set. }}
        <div
          class='pretui-lb-gallery'
          {{photoswipeGallery this this.engineKey}}
        >
          {{#each this.groups as |group|}}
            <section
              class='pretui-lb-section'
              data-sectioned={{if this.sectioned 'true' 'false'}}
            >
              {{#if this.sectioned}}
                {{#if (has-block 'section')}}
                  {{yield group.section group.index to='section'}}
                {{else}}
                  {{#if group.section.title}}
                    <h3 class='pretui-lb-section-title'>{{group.section.title}}</h3>
                  {{/if}}
                  {{#if group.section.caption}}
                    <p class='pretui-lb-section-caption'>{{group.section.caption}}</p>
                  {{/if}}
                {{/if}}
              {{/if}}
                <div
                  class='pretui-lb-grid'
                  data-layout={{this.layout}}
                  style={{this.gridStyle}}
                >
                  {{#each group.items key='src' as |item|}}
                    <a
                      class='pretui-lb-link'
                      href={{item.src}}
                      target='_blank'
                      rel='noopener noreferrer'
                      data-pswp-width={{item.width}}
                      data-pswp-srcset={{item.srcset}}
                      data-pswp-height={{item.height}}
                      data-assumed-size={{if item.assumed 'true'}}
                      aria-label={{item.position}}
                      style={{this.tileStyle item}}
                    >
                      <img
                        class='pretui-lb-thumb'
                        sizes={{if item.thumbSrcset this.thumbnailSizes}}
                        srcset={{item.thumbSrcset}}
                        src={{item.thumb}}
                        alt={{item.alt}}
                        loading='lazy'
                        decoding='async'
                      />
                    </a>
                  {{/each}}
                </div>
            </section>
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
        .pretui-lb-gallery {
          display: flex;
          flex-direction: column;
          gap: var(--pretui-lb-section-gap, 32px);
          min-width: 0;
        }
        .pretui-lb-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }
        .pretui-lb-section[data-sectioned='false'] {
          display: contents;
        }
        .pretui-lb-section-title {
          margin: 0;
          font: var(--weight-heading, 600) var(--text-heading, 1.125rem) / 1.2
            var(--font-heading, inherit);
          color: var(--foreground);
        }
        .pretui-lb-section-caption {
          margin: 0;
          color: var(--muted-foreground);
        }
        .pretui-lb-grid {
          display: grid;
          grid-template-columns: var(--pretui-lb-columns);
          gap: var(--pretui-lb-gap);
          min-width: 0;
        }
        /* Justified rows. Each tile grows in proportion to its own ratio from
           a basis of row height × ratio, so every tile in a row ends at the
           same height and the row fills the width; nothing is cropped. The
           trailing pseudo-element soaks up the last row's slack so it keeps
           the target height instead of blowing up. */
        .pretui-lb-grid[data-layout='justified'] {
          display: flex;
          flex-wrap: wrap;
        }
        .pretui-lb-grid[data-layout='justified']::after {
          content: '';
          flex-grow: 1000000;
        }
        .pretui-lb-grid[data-layout='justified'] .pretui-lb-link {
          flex: calc(var(--pretui-lb-ratio, 4 / 3)) 1
            calc(
              var(--pretui-lb-row, clamp(96px, 16vw, 200px)) *
                (var(--pretui-lb-ratio, 4 / 3))
            );
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
