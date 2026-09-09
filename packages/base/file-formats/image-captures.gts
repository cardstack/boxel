// The image family's declared-screenshot slots and their capture-only
// components. Capture-only means: referenced only from the `static
// screenshots` declaration and rendered only by the screenshot render route
// during the prerender pass — never part of the format API or `@fields`.
//
// This module sits in card-api's universal dependency graph (ImageDef's
// declaration reaches it), so it leans on the primitives already there
// (`FileImage`, the shared letterbox rule, the view-model projection) and
// nothing heavier. It must not import card-api at runtime — card-api imports
// it — so the ScreenshotSpec type comes in type-only.
import GlimmerComponent from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { FileImage } from './file-image';
import { letterboxImage } from './file-presentation';
import { ensureFileViewModel, type FileViewModel } from './file-view-model';

import type { ScreenshotSpec } from '../card-api';

interface CaptureSignature {
  Args: {
    // The FileDef instance (the screenshot render route passes the same
    // author surface a format render gets).
    model: any;
  };
  Element: HTMLElement;
}

// The tile capture that feeds `useAsThumbnail` and the fitted cell: the
// pixels fill the declared box edge to edge, cropped like the fitted stage
// crops, except where the shared letterbox rule says cropping would destroy
// the picture (vectors, extreme proportions) — those contain on the paper
// matte instead, matching the live fitted rendering they stand in for.
class ImageThumbCapture extends GlimmerComponent<CaptureSignature> {
  @cached
  get model(): FileViewModel {
    return ensureFileViewModel(this.args.model, 'fitted');
  }

  get fit() {
    return letterboxImage(this.model.previewKind, this.model.aspectRatio)
      ? 'contain'
      : 'cover';
  }

  <template>
    <FileImage
      class='thumb-capture'
      @src={{this.model.imageUrl}}
      @alt=''
      data-image-fit={{this.fit}}
    />
    <style scoped>
      .thumb-capture {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }
      .thumb-capture[data-image-fit='cover'] {
        object-fit: cover;
        object-position: center;
      }
      .thumb-capture[data-image-fit='contain'] {
        object-fit: contain;
        /* Fixed hex on purpose, not the --fd-paper token: capture pixels
           bake whatever the token resolves to, and content-keyed
           carry-forward would leave old and new mattes side by side across
           a grid after a theme-default change. The value is what --fd-paper
           resolves to today. */
        background: #f7f7f5;
      }
    </style>
  </template>
}

// A downscaled copy for `srcset`: the picture contained in the declared box
// at its own aspect, never upscaled (a small source keeps its real pixels
// centered rather than trading them for blur), on the slot's transparent
// background so the letterbox margins are invisible wherever the rendition
// is drawn contained.
class ImageRenditionCapture extends GlimmerComponent<CaptureSignature> {
  @cached
  get model(): FileViewModel {
    return ensureFileViewModel(this.args.model, 'embedded');
  }

  <template>
    <FileImage class='rendition-capture' @src={{this.model.imageUrl}} @alt='' />
    <style scoped>
      .rendition-capture {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        object-fit: scale-down;
        object-position: center;
      }
    </style>
  </template>
}

// The rendition slots `srcset` assembly reads, ordered small to large. One
// named slot per rendition size: multi-size per name is not a capture
// feature, so each size is its own declaration.
export const IMAGE_RENDITION_SLOT_NAMES = [
  'rendition-640',
  'rendition-1280',
] as const;

// The image family's declared slots, in two tiers matching where they are
// consumed. Both tiers key on `keyBy: 'file-content'`: an image's captures
// derive from its bytes, so a metadata-only edit must skip the re-decode.
// webp throughout — alpha-capable (the renditions' transparent letterbox
// margins need it) and the strongest encoder `page.screenshot` offers for
// photographic content.

// Every image family member's thumbnail, assigned to `ImageDef.screenshots`
// (vectors included — the fitted cell and the thumbnail fallback chain
// consume `thumb` for SVG and raster alike). The box is the recommended
// thumbnail box: the CardsGrid tile, 170×250 at the default
// deviceScaleFactor of 2.
export const IMAGE_THUMB_SCREENSHOTS: Record<string, ScreenshotSpec> = {
  thumb: {
    render: ImageThumbCapture,
    width: 170,
    height: 250,
    keyBy: 'file-content',
    useAsThumbnail: true,
    type: 'webp',
  },
};

// The srcset renditions, assigned to `RasterImageDef.screenshots` rather
// than `ImageDef`'s: srcset excludes vectors and the fitted cell uses
// `thumb`, so an SVG's renditions would be pure prerender cost with no
// consumer — and class placement is the only exclusion lever, since
// `getScreenshots` merges every declaration level and has no
// removal-by-subclass mechanism. Residual: `GifDef` is a raster, so GIFs
// still pay for renditions the srcset gate never reads; that resolves if
// renditions become consumable for stills, and the placement can be
// revisited then. The renditions capture at deviceScaleFactor 1 so their
// declared width IS their physical width — the `w` descriptor srcset needs.
export const IMAGE_RENDITION_SCREENSHOTS: Record<string, ScreenshotSpec> = {
  'rendition-640': {
    render: ImageRenditionCapture,
    width: 640,
    height: 480,
    deviceScaleFactor: 1,
    keyBy: 'file-content',
    type: 'webp',
    background: 'transparent',
  },
  'rendition-1280': {
    render: ImageRenditionCapture,
    width: 1280,
    height: 960,
    deviceScaleFactor: 1,
    keyBy: 'file-content',
    type: 'webp',
    background: 'transparent',
  },
};
