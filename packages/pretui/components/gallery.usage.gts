// Pretui — Gallery usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Gallery } from './gallery';
import { Token } from './token';
import { GALLERY_SET, MIXED_SET } from '../demo-media-library';

// ── Gallery ──────────────────────────────────────────────────────────────
class GalleryUsage extends Component {
  plates = GALLERY_SET;
  mixed = MIXED_SET;

  @tracked mode: 'none' | 'single' | 'multi' = 'multi';
  @tracked fit: 'intrinsic' | 'cover' | 'contain' = 'intrinsic';
  @tracked thumbHeight = 64;
  @tracked showHero = true;
  @tracked showCounter = true;
  @tracked chosen = '—';
  @tracked opened = '—';

  modeOptions = ['none', 'single', 'multi'];
  fitOptions = ['intrinsic', 'cover', 'contain'];

  setMode = (v: string) => (this.mode = v as 'none' | 'single' | 'multi');
  setFit = (v: string) =>
    (this.fit = v as 'intrinsic' | 'cover' | 'contain');
  setThumbHeight = (v: number | null) => (this.thumbHeight = v ?? 64);
  setShowHero = (v: boolean) => (this.showHero = v);
  setShowCounter = (v: boolean) => (this.showCounter = v);

  noteSelection = (indices: number[]) => {
    this.chosen = indices.length === 0 ? 'none' : indices.join(', ');
  };
  noteOpen = (index: number) => {
    this.opened = `index ${index}`;
  };

  get usage(): string {
    return [
      '<Gallery',
      '  @assets={{this.plates}}',
      "  @label='Consignment plates'",
      "  @selectionMode='multi'",
      '  @onSelectionChange={{this.stage}}',
      '  @onOpen={{this.openLightbox}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Gallery'
      @description="Explicit thumb-navigation over a known set: a hero stage driven by an active index, and a rail that selects, ranges and opens. Distinct from Carousel, which rotates, and from AssetGrid, which is the wrapping shelf with its own measured column count — a gallery is the shape where you can see the whole set and choose from it, so there is no autoplay here and never will be. The rail is a real listbox with the full APG contract: one tab stop, arrows, Home/End, Space to toggle, Enter to open, Shift+Arrow and Shift+Click for a range, Ctrl/Cmd+A for all — every pointer gesture with its keyboard twin beside it, which is the test all four catalog implementations failed. The rail is INTRINSIC by default: cells keep their own aspect ratio at a shared height, so a panorama still reads as a panorama instead of being letterboxed into a square."
      @source={{this.usage}}
    >
      <:example>
        <Gallery
          @assets={{this.plates}}
          @label='Consignment plates'
          @selectionMode={{this.mode}}
          @cellFit={{this.fit}}
          @thumbHeight={{this.thumbHeight}}
          @showHero={{this.showHero}}
          @showCounter={{this.showCounter}}
          @onSelectionChange={{this.noteSelection}}
          @onOpen={{this.noteOpen}}
        />
        <p class='dml-readout'>
          <span class='dml-readoutLabel'>selection</span>
          <Token @value={{this.chosen}} />
          <span class='dml-readoutLabel'>opened</span>
          <Token @value={{this.opened}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.Array
          @name='assets'
          @description='The set, in display order. MediaAssetSpec — only src is required; width and height let the rail keep each cell true to shape and let the hero reserve its box.'
          @value={{this.plates}}
          @hideControls={{true}}
        />
        <Args.String
          @name='selectionMode'
          @value={{this.mode}}
          @options={{this.modeOptions}}
          @defaultValue='none'
          @description='Ranges need multi. In single, a Shift or Ctrl gesture collapses to a plain select rather than silently doing nothing.'
          @onInput={{this.setMode}}
        />
        <Args.String
          @name='cellFit'
          @value={{this.fit}}
          @options={{this.fitOptions}}
          @defaultValue='intrinsic'
          @description='intrinsic keeps every cell true to its own ratio at one shared height; cover locks all cells to cellRatio and crops; contain locks and letterboxes. Switch it here and watch the two panoramas in this set stop being panoramas.'
          @onInput={{this.setFit}}
        />
        <Args.Number
          @name='thumbHeight'
          @value={{this.thumbHeight}}
          @min={{40}}
          @max={{120}}
          @defaultValue={{64}}
          @description='Rail cell height in px. A narrow pane falls back to a derived narrow value rather than a hardcoded one, so this argument keeps meaning at every width.'
          @onInput={{this.setThumbHeight}}
        />
        <Args.Bool
          @name='showHero'
          @value={{this.showHero}}
          @defaultValue={{true}}
          @description='Turn the stage off for a bare rail — a filmstrip under something that is already showing the asset.'
          @onInput={{this.setShowHero}}
        />
        <Args.Bool
          @name='showCounter'
          @value={{this.showCounter}}
          @defaultValue={{true}}
          @description='The step buttons and the tabular "3 of 8" counter above the stage.'
          @onInput={{this.setShowCounter}}
        />
        <Args.Number
          @name='activeIndex'
          @description='Controlled cursor. Omit for uncontrolled; defaultActiveIndex seeds it.'
          @hideControls={{true}}
        />
        <Args.Array
          @name='selected'
          @description='Controlled selection, as indices. Omit for uncontrolled; defaultSelected seeds it.'
          @hideControls={{true}}
        />
        <Args.String
          @name='ratio'
          @description="Aspect ratio reserved for the hero. Defaults to the active asset's own, then 4 / 3."
          @hideControls={{true}}
        />
        <Args.String
          @name='cellRatio'
          @description="Locked cell ratio for cover and contain. Ignored by intrinsic. Default '4 / 3'."
          @hideControls={{true}}
        />
        <Args.Action
          @name='onActiveChange'
          @description='(index, asset) on every cursor move, keyboard or pointer.'
        />
        <Args.Action
          @name='onSelectionChange'
          @description='(indices, assets) with the next selection, sorted and de-duplicated.'
        />
        <Args.Action
          @name='onOpen'
          @description='(index, asset) on Enter and on double-click. This is the path into a viewer. Gallery deliberately does NOT embed PhotoSwipe — Lightbox owns that engine, and running two of them over one set is how focus restoration breaks.'
        />
        <Args.Yield
          @name='hero'
          @description='Replaces the stage; receives the active asset.'
        />
        <Args.Yield
          @name='overlay'
          @description='Rendered over the stage — captions, actions, a price.'
        />
        <Args.Yield
          @name='empty'
          @description='Replaces the built-in empty state.'
        />
      </:api>

      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-gallery-thumb'
          @type='dimension'
          @description='Rail cell height. Set through @thumbHeight.'
        />
        <Css.Basic
          @name='pretui-gallery-thumb-narrow'
          @type='dimension'
          @description='The height a narrow pane falls back to, derived from @thumbHeight so the argument is never overwritten by the container query.'
        />
        <Css.Basic
          @name='pretui-gallery-hero-aspect'
          @type='ratio'
          @description='Reserved hero ratio.'
        />
        <Css.Basic
          @name='pretui-gallery-cell-aspect'
          @type='ratio'
          @description="Per-cell ratio. Under intrinsic this is the asset's own."
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .dml-readout {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-2, 6px);
        margin: var(--space-3, 8px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .dml-readoutLabel {
        font-weight: var(--weight-medium, 500);
      }
    </style>
  </template>
}

export const DEMOS_GALLERY: Record<string, unknown> = {
  Gallery: GalleryUsage,
};
