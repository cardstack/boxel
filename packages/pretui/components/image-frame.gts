// Pretui — ImageFrame: a framed still that reserves its aspect ratio and carries real alt text.
import Component from '@glimmer/component';
import { cssStyle } from '../pretui-css';
import { Token } from './token';
import type { ResolvedMediaAsset } from '../internal/media-viewer';

/**
 * A framed still. Deliberately small: Appendix M gives images to Lightbox
 * (PhotoSwipe) and ImageCropper (Cropper.js), neither of which is vendored
 * yet. What this DOES do is the part those libraries do not — reserve the
 * exact aspect ratio before the bytes arrive, so nothing reflows, and carry
 * real alt text.
 */
export interface ImageFrameSignature {
  Args: { asset: ResolvedMediaAsset };
  Element: HTMLDivElement;
}

export class ImageFrame extends Component<ImageFrameSignature> {
  /** Validate-or-drop through the shared guard rather than interpolating a
   * caller string into a style attribute. `undefined` when the ratio does not
   * pass, so the frame keeps the stylesheet's own `auto`. */
  get style() {
    return cssStyle('--pretui-frame-aspect', this.args.asset.aspectRatio);
  }
  get alt(): string {
    return this.args.asset.alt ?? this.args.asset.label;
  }
  get dims(): string {
    const { width, height } = this.args.asset;
    return width && height ? `${width} × ${height}` : '';
  }

  <template>
    <div
      class='pretui-frame'
      style={{this.style}}
      data-test-pretui-image-frame
      ...attributes
    >
      <img
        class='pretui-frame-img'
        src={{@asset.src}}
        alt={{this.alt}}
        width={{@asset.width}}
        height={{@asset.height}}
        loading='lazy'
        decoding='async'
      />
      {{#if this.dims}}
        <p class='pretui-frame-meta'>
          <Token @value={{this.dims}} />
        </p>
      {{/if}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-frame {
          --pretui-frame-aspect: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .pretui-frame-img {
          display: block;
          width: 100%;
          height: auto;
          /* Reserved BEFORE the bytes arrive — the Law-8 corollary. When the
             caller gave no dimensions this collapses to `auto` and the
             intrinsic size takes over, which is the honest degrade. */
          aspect-ratio: var(--pretui-frame-aspect);
          object-fit: contain;
          background: color-mix(
            in oklch,
            var(--foreground) 6%,
            var(--card)
          );
          border-radius: var(--radius);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        }
        .pretui-frame-meta {
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
      }
    </style>
  </template>
}
