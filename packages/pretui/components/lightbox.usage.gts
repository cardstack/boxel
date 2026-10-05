// Pretui — Lightbox usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Lightbox } from './lightbox';
import type { MediaAssetSpec } from '../internal/media-viewer';
import { platePoster } from '../media-examples';
import { Token } from './token';

// ── Lightbox ─────────────────────────────────────────────────────────────
const PLATES: Array<[string, number, number]> = [
  ['Kandy plate 04', 1600, 1067],
  ['Dust grade macro', 1400, 1400],
  ['Chest 118 stencil', 900, 1200],
  ['Auction floor', 2000, 1333],
  ['Grading chart', 1200, 800],
  ['Second flush, wet leaf', 1500, 1000],
  ['Manifest, page 3', 1000, 1414],
  ['Cupping table', 1800, 1200],
];

/** A gallery whose `src` is the picture itself, not a URL that has to
 * resolve — the whole point of a deterministic SVG poster. */

const GALLERY: readonly MediaAssetSpec[] = PLATES.map(
  ([name, width, height]) => ({
    src: platePoster(name, `${width} / ${height}`),
    thumbnail: platePoster(name, `${width} / ${height}`),
    name,
    mimeType: 'image/svg+xml',
    kind: 'image' as const,
    alt: `${name} — a generated stand-in plate`,
    width,
    height,
  }),
);

/** One asset with no dimensions at all, so the "we had to assume this size"
 * mark on a Lightbox tile has something honest to appear on. */

const GALLERY_WITH_UNKNOWN: readonly MediaAssetSpec[] = GALLERY.concat([
  {
    src: platePoster('Unmeasured plate', '3 / 2'),
    name: 'Unmeasured plate',
    kind: 'image' as const,
    alt: 'A plate whose dimensions the host never recorded',
  },
]);

class LightboxUsage extends Component {
  gallery = GALLERY;
  galleryWithUnknown = GALLERY_WITH_UNKNOWN;

  @tracked columns = 4;
  @tracked loop = true;
  @tracked counter = true;
  @tracked zoom = true;
  @tracked showUnknown = false;
  @tracked opened = '—';

  setColumns = (v: number | null) => (this.columns = v ?? 4);
  setLoop = (v: boolean) => (this.loop = v);
  setCounter = (v: boolean) => (this.counter = v);
  setZoom = (v: boolean) => (this.zoom = v);
  setShowUnknown = (v: boolean) => (this.showUnknown = v);
  noteOpen = (index: number) => (this.opened = `opened #${index + 1}`);
  noteChange = (index: number) => (this.opened = `showing #${index + 1}`);
  noteClose = () => (this.opened = 'closed');

  get assets(): readonly MediaAssetSpec[] {
    return this.showUnknown ? this.galleryWithUnknown : this.gallery;
  }
  get usage(): string {
    return [
      '<Lightbox',
      '  @assets={{this.assets}}',
      `  @columns={{${this.columns}}}`,
      '  @onChange={{this.note}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Lightbox'
      @description="A thumbnail gallery that opens into PhotoSwipe 5.4.4 (MIT, vendored at ./photoswipe) for pinch-zoom, pan and keyboard navigation. Two things are worth doing before reading the API. First, Tab into the grid: every tile is an <a href>, not a div, so it is focusable, middle-clickable and copy-link-able, and with no JavaScript at all it still opens the file. Second, open one and press Escape — focus lands back on exactly the tile you left, because that is the dialog pattern and not a nicety. The stylesheet is the interesting engineering: PhotoSwipe renders into document.body where scoped CSS cannot reach it, and a side-effect .css import breaks realm indexing outright, so the sheet travels as a string and is installed once, refcounted, and removed when the last Lightbox on the page is destroyed."
      @source={{this.usage}}
    >
      <:example>
        <Lightbox
          @assets={{this.assets}}
          @columns={{this.columns}}
          @loop={{this.loop}}
          @counter={{this.counter}}
          @zoom={{this.zoom}}
          @onOpen={{this.noteOpen}}
          @onChange={{this.noteChange}}
          @onClose={{this.noteClose}}
        />
        <p class='dm-readout'>
          <span class='dm-readoutLabel'>viewer</span>
          <Token @value={{this.opened}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.Object
          @name='assets'
          @value={{this.assets}}
          @description='MediaAssetSpec[]. Anything whose kind does not resolve to `image`, or whose source could run script, is dropped and COUNTED — the component says "1 asset is not a linkable image and is not in this gallery" rather than quietly showing a shorter set.'
        />
        <Args.Number
          @name='columns'
          @value={{this.columns}}
          @min={{1}}
          @max={{8}}
          @description='Fixed column count. Omit it and the grid is a responsive auto-fill over @minTile instead, which is the better default in a panel of unknown width.'
          @onInput={{this.setColumns}}
        />
        <Args.Bool
          @name='loop'
          @value={{this.loop}}
          @defaultValue={{true}}
          @description='Wrap from the last image back to the first.'
          @onInput={{this.setLoop}}
        />
        <Args.Bool
          @name='counter'
          @value={{this.counter}}
          @defaultValue={{true}}
          @description="PhotoSwipe's own 3 / 8 counter in the top-left."
          @onInput={{this.setCounter}}
        />
        <Args.Bool
          @name='zoom'
          @value={{this.zoom}}
          @defaultValue={{true}}
          @description='Offer the zoom button. Pinch, double-tap and wheel zoom are unaffected.'
          @onInput={{this.setZoom}}
        />
        <Args.Bool
          @name='showUnknown'
          @value={{this.showUnknown}}
          @defaultValue={{false}}
          @description='DEMO KNOB, not a component arg: appends one asset with no width or height. PhotoSwipe requires dimensions, so the component fills in 1600×1200 and marks the tile with a corner ? — an assumption that is visible beats one that is silent.'
          @onInput={{this.setShowUnknown}}
        />
        <Args.Action
          @name='onOpen'
          @description='(index, asset) when the viewer opens.'
        />
        <Args.Action
          @name='onChange'
          @description='(index, asset) on every slide change.'
        />
        <Args.Action @name='onClose' @description='() when the viewer closes.' />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .dm-readout {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 10px 0 0;
      }
      .dm-readoutLabel {
        font-size: var(--text-ui-xs, 10.5px);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_LIGHTBOX: Record<string, unknown> = {
  Lightbox: LightboxUsage,
};
