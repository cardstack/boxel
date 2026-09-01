// The image family's renderer, projected into the four format shells by
// `FilePreviewStage` — and the content-only component an embedding author
// imports from the `file-formats/index` barrel to render just the pixels. The
// browser is the decoder, so this is one native `<img>` via the `FileImage`
// primitive; the component's whole job is choosing how the pixels meet the
// frame it is handed.
import GlimmerComponent from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { FileImage } from './file-image';
import { letterboxImage } from './file-presentation';
import type { ContentPreviewSignature } from './file-preview-stage';
import {
  ensureFileViewModel,
  type FileFormat,
  type FileViewModel,
} from './file-view-model';

export class ImagePreview extends GlimmerComponent<ContentPreviewSignature> {
  get format(): FileFormat {
    return this.args.format ?? 'embedded';
  }

  // `@model` is the FileDef instance in the content-only case and a prebuilt
  // view model when a shell is rendering; either way the reads below see the
  // shared projection.
  @cached
  get model(): FileViewModel {
    return ensureFileViewModel(this.args.model, this.format);
  }

  // A vector scales crisply at any size and is as likely to be a diagram as a
  // picture, so it always letterboxes at its own proportions — a center-crop
  // that a photograph tolerates would cut through an illustration's subject.
  get isSvg() {
    return this.model.previewKind === 'svg';
  }

  // How the pixels meet the frame. A fitted cell is a fixed collection tile:
  // ordinary shapes fill it edge to edge, and only what `letterboxImage`
  // exempts (vectors, crop-destroying proportions) contains instead — the
  // shared rule the fitted shell's thumbnail rail also applies. The reading
  // formats never crop and never upscale a raster; blowing a small image up
  // to the stage would trade real pixels for blur.
  get fit() {
    if (this.isSvg) {
      return 'contain';
    }
    if (this.format === 'fitted') {
      return letterboxImage(this.model.previewKind, this.model.aspectRatio)
        ? 'contain'
        : 'cover';
    }
    return 'scale-down';
  }

  // The fitted strip already announces the file name, so the cell's pixels are
  // decorative there; the reading formats describe the image themselves.
  get alt() {
    return this.format === 'fitted' ? '' : (this.model.name ?? '');
  }

  get loading(): 'eager' | 'lazy' {
    return this.format === 'fitted' ? 'lazy' : 'eager';
  }

  <template>
    <FileImage
      class='image-preview'
      @src={{this.model.imageUrl}}
      @alt={{this.alt}}
      @loading={{this.loading}}
      @decoding='async'
      width={{this.model.width}}
      height={{this.model.height}}
      data-image-fit={{this.fit}}
      data-test-image-preview
    />
    <style scoped>
      /* Fill the stage frame like the stage's own thumbnail sibling does: an
         absolute box against the relatively-positioned stage resolves both axes
         to the frame. A plain height:100% grid child does not — the stage's auto
         row leaves the percentage unresolved, so the browser falls back to the
         intrinsic aspect ratio from the img's width/height attributes and
         overflows a frame taller than it. object-fit then does the fitting
         within a correctly sized box. */
      .image-preview {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: block;
      }
      .image-preview[data-image-fit='cover'] {
        object-fit: cover;
        object-position: center;
      }
      .image-preview[data-image-fit='contain'] {
        object-fit: contain;
        padding: 0.375rem;
      }
      .image-preview[data-image-fit='scale-down'] {
        object-fit: scale-down;
      }
      /* Letterboxed and transparent pixels sit on the paper matte rather than
         the stage gray, matching the fitted shell's contained thumbnails. */
      .image-preview[data-image-fit='contain'],
      .image-preview[data-image-fit='scale-down'] {
        background: var(--fd-paper, var(--card, #f7f7f5));
      }
    </style>
  </template>
}
