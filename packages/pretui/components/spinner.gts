// Pretui — Spinner: an indeterminate busy indicator, sized in pixels.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import type { PretuiSize, PretuiSizeArg } from '../pretui-primitives';
import { resolvePixelSize } from '../internal/feedback';

const SPINNER_PX: Record<PretuiSize, number> = {
  xs: 9,
  s: 11,
  m: 13,
  l: 17,
  xl: 22,
};

export interface SpinnerSignature {
  Args: {
    /** pixels, or any spelling of the `xs|s|m|l|xl` scale */
    size?: number | PretuiSizeArg;
  };
  Element: HTMLSpanElement;
}

// `aria-label` deliberately stays a plain attribute above `...attributes`,
// not an `@arg`: a caller who needs a different accessible name passes
// `aria-label='…'` and splattributes wins. Promoting it to an arg is the
// native-attribute-swallowing bug this whole alias pass exists to avoid.
export class Spinner extends Component<SpinnerSignature> {
  get style() {
    let size = resolvePixelSize(this.args.size, SPINNER_PX);
    return htmlSafe(`width: ${size}px; height: ${size}px`);
  }
  <template>
    <span class='pretui-spinner' role='status' aria-label='Loading' style={{this.style}} data-test-pretui-spinner ...attributes></span>
    <style scoped>
      @keyframes pretui-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .pretui-spinner {
        display: inline-block;
        border-radius: 50%;
        border: 1.5px solid color-mix(in oklch, currentColor 25%, transparent);
        border-top-color: currentColor;
        animation: pretui-spin 0.7s linear infinite;
        flex: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-spinner {
          animation-duration: 2.8s;
        }
      }
    </style>
  </template>
}
