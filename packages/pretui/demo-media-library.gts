// Pretui — demo-media-library: usage pages for AssetWell and Gallery.
//
// Everything on these pages works with no network. The pictures are the
// deterministic SVG posters `media-examples.gts` builds from a seeded hash,
// so a "photograph" here is arithmetic and the pages render identically on
// every machine and in every test run.
//
// The AssetWell page is a state machine you can drive by hand: the four
// states are switches in the properties rail rather than four separate
// examples, because the whole point of the component is that they are ONE
// slot with one layout and nothing jumps between them.
import Component from '@glimmer/component';

import { FreestyleUsage } from './components/freestyle-usage';
import { Gallery } from './components/gallery';
import type { MediaAssetSpec } from './internal/media-viewer';
import { platePoster, TONE_ASSET } from './media-examples';

// ── Fixtures ─────────────────────────────────────────────────────────────

/** Deliberately mixed ratios — a square, a portrait, two panoramas — because
 * the intrinsic rail is the claim and a set of identical 4:3 plates would
 * hide whether it is true. */
const PLATES: Array<[string, number, number]> = [
  ['Chest 118, front', 1600, 1067],
  ['Grading chart', 2400, 800],
  ['Second flush, wet leaf', 1200, 1200],
  ['Manifest, page 3', 1000, 1414],
  ['Auction floor', 2000, 1333],
  ['Estate boundary, aerial', 2600, 780],
  ['Cupping table', 1500, 1000],
  ['Dust grade macro', 1100, 1100],
];

export const GALLERY_SET: readonly MediaAssetSpec[] = PLATES.map(
  ([name, width, height]) => ({
    src: platePoster(name, `${width} / ${height}`),
    thumbnail: platePoster(name, `${width} / ${height}`),
    name,
    kind: 'image' as const,
    mimeType: 'image/svg+xml',
    alt: `${name} — a generated stand-in plate`,
    width,
    height,
  }),
);

/** One non-image in the set, so the hero's adapter routing is visible rather
 * than asserted: selecting it swaps the stage to an audio player without the
 * gallery knowing what an audio player is. */
export const MIXED_SET: readonly MediaAssetSpec[] = GALLERY_SET.slice(0, 5).concat([
  TONE_ASSET,
]);

// ── Gallery, mixed kinds ─────────────────────────────────────────────────

class GalleryMixedDemo extends Component {
  mixed = MIXED_SET;

  get usage(): string {
    return [
      '<Gallery',
      '  @assets={{this.mixed}}',
      "  @label='Lot 118 — pictures and the tasting note'",
      "  @ratio='16 / 9'",
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Gallery — mixed kinds'
      @description='The adapter contract doing its job. Five pictures and one audio file in one set: step to the last cell and the stage swaps to an audio player, with transport and captions, without Gallery knowing what an audio player is. That is the whole value of MediaViewer being the hero — a later kind (PDF, SVG, font, CAD) is an adapter registration, not a rewrite of this component. The rail marks the non-image with its own kind glyph and duration badge, so the swap is not a surprise.'
      @source={{this.usage}}
    >
      <:example>
        <Gallery
          @assets={{this.mixed}}
          @label='Lot 118 — pictures and the tasting note'
          @ratio='16 / 9'
          @selectionMode='single'
        />
      </:example>

      <:api as |Args|>
        <Args.Array
          @name='assets'
          @description='Five generated plates and the six-second tone that media-examples.gts builds from twelve fixed notes. Nothing here touches the network.'
          @value={{this.mixed}}
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

// ── The registry ─────────────────────────────────────────────────────────

export const DEMOS_MEDIA_LIBRARY: Record<string, unknown> = {
  GalleryMixed: GalleryMixedDemo,
};
