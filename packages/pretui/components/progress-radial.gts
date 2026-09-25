// Pretui — ProgressRadial: quantitative progress as a ring, sized in pixels.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import type { PretuiSize, PretuiSizeArg } from '../pretui-primitives';
import { resolvePixelSize } from '../internal/feedback';

const RADIAL_PX: Record<PretuiSize, number> = {
  xs: 16,
  s: 22,
  m: 28,
  l: 36,
  xl: 48,
};

export interface ProgressRadialSignature {
  Args: {
    value: number;
    max?: number;
    /** pixels, or any spelling of the `xs|s|m|l|xl` scale */
    size?: number | PretuiSizeArg;
  };
  Element: HTMLSpanElement;
}

export class ProgressRadial extends Component<ProgressRadialSignature> {
  get pct() {
    let max = this.args.max ?? 100;
    return Math.max(0, Math.min(100, (this.args.value / max) * 100));
  }
  get style() {
    let size = resolvePixelSize(this.args.size, RADIAL_PX);
    return htmlSafe(`width: ${size}px; height: ${size}px; --pretui-radial-pct: ${this.pct}`);
  }
  get max() {
    return this.args.max ?? 100;
  }
  <template>
    <span
      class='pretui-radial'
      role='progressbar'
      aria-valuenow={{@value}}
      aria-valuemax={{this.max}}
      style={{this.style}}
      data-test-pretui-radial
      ...attributes
    ></span>
    <style scoped>
      .pretui-radial {
        display: inline-grid;
        place-items: center;
        border-radius: 50%;
        background: conic-gradient(var(--primary) calc(var(--pretui-radial-pct, 0) * 1%), var(--inset, var(--boxel-100)) 0);
      }
      .pretui-radial::after {
        content: '';
        display: block;
        width: 70%;
        height: 70%;
        margin: 15%;
        border-radius: 50%;
        background: var(--card);
      }
    </style>
  </template>
}
