// The image family's renderer, projected into the four format shells by
// `FilePreviewStage`. The browser is the decoder, so this is one native
// `<img>` via the `FileImage` primitive; the component's whole job is choosing
// how the pixels meet the frame the shell hands it.
import GlimmerComponent from '@glimmer/component';

import { FileImage } from './file-image';
import { letterboxImage } from './file-presentation';
import type { FilePreviewSignature } from './file-preview-stage';

export class ImagePreview extends GlimmerComponent<FilePreviewSignature> {
  // A vector scales crisply at any size and is as likely to be a diagram as a
  // picture, so it always letterboxes at its own proportions — a center-crop
  // that a photograph tolerates would cut through an illustration's subject.
  get isSvg() {
    return this.args.model?.previewKind === 'svg';
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
    if (this.args.mode === 'fitted') {
      return letterboxImage(
        this.args.model?.previewKind,
        this.args.model?.aspectRatio,
      )
        ? 'contain'
        : 'cover';
    }
    return 'scale-down';
  }

  // The fitted strip already announces the file name, so the cell's pixels are
  // decorative there; the reading formats describe the image themselves.
  get alt() {
    return this.args.mode === 'fitted' ? '' : (this.args.model?.name ?? '');
  }

  get loading(): 'eager' | 'lazy' {
    return this.args.mode === 'fitted' ? 'lazy' : 'eager';
  }

  <template>
    <FileImage
      class='image-preview'
      @src={{@model.imageUrl}}
      @alt={{this.alt}}
      @loading={{this.loading}}
      @decoding='async'
      width={{@model.width}}
      height={{@model.height}}
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
