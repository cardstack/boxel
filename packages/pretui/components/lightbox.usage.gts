// Pretui — Lightbox usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Lightbox } from './lightbox';
import type { LightboxSection } from './lightbox';
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
  @tracked layout: 'grid' | 'justified' = 'grid';
  @tracked filmstrip = false;
  @tracked download = false;
  @tracked sectioned = false;
  layouts = ['grid', 'justified'];
  @tracked opened = '—';

  setColumns = (v: number | null) => (this.columns = v ?? 4);
  setLoop = (v: boolean) => (this.loop = v);
  setCounter = (v: boolean) => (this.counter = v);
  setZoom = (v: boolean) => (this.zoom = v);
  setShowUnknown = (v: boolean) => (this.showUnknown = v);
  setLayout = (v: string | null) =>
    (this.layout = v === 'justified' ? 'justified' : 'grid');
  setFilmstrip = (v: boolean) => (this.filmstrip = v);
  setDownload = (v: boolean) => (this.download = v);
  setSectioned = (v: boolean) => (this.sectioned = v);
  noteOpen = (index: number) => (this.opened = `opened #${index + 1}`);
  noteChange = (index: number) => (this.opened = `showing #${index + 1}`);
  noteClose = () => (this.opened = 'closed');

  get assets(): readonly MediaAssetSpec[] {
    return this.showUnknown ? this.galleryWithUnknown : this.gallery;
  }
  /** The same plates as two chapters, for the one-viewer-across-sections
   * demo: open the last plate of the first and swipe into the second. */
  get sections(): readonly LightboxSection[] | undefined {
    if (!this.sectioned) {
      return undefined;
    }
    const all = this.assets;
    return [
      { title: 'The sale', caption: 'Plates from the auction floor.', assets: all.slice(0, 4) },
      { title: 'The cupping', assets: all.slice(4) },
    ];
  }
  get usage(): string {
    return [
      '<Lightbox',
      this.sectioned ? '  @sections={{this.sections}}' : '  @assets={{this.assets}}',
      `  @columns={{${this.columns}}}`,
      ...(this.layout === 'justified' ? ["  @layout='justified'"] : []),
      ...(this.filmstrip ? ['  @filmstrip={{true}}'] : []),
      ...(this.download ? ['  @download={{true}}'] : []),
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
          @sections={{this.sections}}
          @layout={{this.layout}}
          @filmstrip={{this.filmstrip}}
          @download={{this.download}}
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
        <Args.String
          @name='layout'
          @value={{this.layout}}
          @options={{this.layouts}}
          @defaultValue='grid'
          @description="'grid' keeps every tile at its own ratio in a column, so a portrait makes its row taller. 'justified' lays equal-height rows edge to edge with nothing cropped — the Google Photos / Flickr layout, and the one for mixed orientations."
          @onInput={{this.setLayout}}
        />
        <Args.String
          @name='rowHeight'
          @defaultValue='clamp(96px, 16vw, 200px)'
          @description="Target row height for the justified layout; rows stretch from it to fill the width."
        />
        <Args.Bool
          @name='filmstrip'
          @value={{this.filmstrip}}
          @defaultValue={{false}}
          @description='A thumbnail rail along the bottom of the open viewer; the current photo is wider, lit and kept centred. Hides with the chrome when a tap toggles it.'
          @onInput={{this.setFilmstrip}}
        />
        <Args.Bool
          @name='download'
          @value={{this.download}}
          @defaultValue={{false}}
          @description="A save button in the viewer's toolbar: a real link with download on the open photo's full-size file."
          @onInput={{this.setDownload}}
        />
        <Args.Bool
          @name='sections'
          @value={{this.sectioned}}
          @defaultValue={{false}}
          @description='{title?, caption?, assets}[] instead of @assets: a grid per chapter, ONE viewer over all of them, so a swipe carries on from one chapter into the next. Head each with <:section as |section index|>, or take the default title and caption. (Toggle here splits the plates into two chapters.)'
          @onInput={{this.setSectioned}}
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
