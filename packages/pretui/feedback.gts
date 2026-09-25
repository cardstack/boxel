// Pretui — feedback territory. Translated from pretui-design-system
// (components/feedback + css/structure.css). Alert takes tones through Law 2
// (never baked semantic hexes); Progress (quantitative) must look different
// from Meter (qualitative). Realm adaptation: LoadingState's elapsed clock is
// caller-supplied (@elapsed) — no timers in realm components.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { resolveSize, resolveTone } from './controls';
import type { PretuiSize, PretuiSizeArg, PretuiToneArg } from './controls';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const ALERT_TONES: readonly AlertTone[] = [
  'info',
  'success',
  'warning',
  'danger',
];
// shadcn's Alert has one `variant` enum rather than a tone. Both of its
// values map onto tones this component already paints.
const ALERT_VARIANTS: Record<string, AlertTone> = {
  default: 'info',
  destructive: 'danger',
};
const ALERT_HUES: Record<AlertTone, string> = {
  info: 'var(--pretui-info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--destructive)',
};
const ALERT_GLYPHS: Record<AlertTone, string> = {
  info: 'i',
  success: '✓',
  warning: '!',
  danger: '✕',
};

export interface AlertSignature {
  Args: {
    /** accepts the React tone spellings — `destructive`/`error` → danger,
     * `positive` → success, `notice` → warning. Tones outside the four an
     * Alert paints fall back to `info` rather than emitting a dead
     * `data-tone`. */
    tone?: AlertTone | PretuiToneArg;
    title?: string;
    /** alias — shadcn's one-enum Alert API (`default` | `destructive`) */
    variant?: 'default' | 'destructive';
  };
  Blocks: { default: []; action: [] };
  Element: HTMLDivElement;
}

export class Alert extends Component<AlertSignature> {
  get tone(): AlertTone {
    let fromVariant = this.args.variant
      ? ALERT_VARIANTS[this.args.variant]
      : undefined;
    return resolveTone(this.args.tone, ALERT_TONES, fromVariant ?? 'info');
  }
  get role() {
    return this.tone === 'danger' ? 'alert' : 'status';
  }
  get hueStyle() {
    return htmlSafe(`--pretui-alert-hue: ${ALERT_HUES[this.tone]}`);
  }
  get glyph() {
    return ALERT_GLYPHS[this.tone];
  }
  <template>
    <div class='pretui-alert' role={{this.role}} style={{this.hueStyle}} data-test-pretui-alert ...attributes>
      <span class='pretui-alert-glyph'>{{this.glyph}}</span>
      <div class='pretui-alert-body'>
        {{#if @title}}<div class='pretui-alert-title'>{{@title}}</div>{{/if}}
        {{#if (has-block)}}<div>{{yield}}</div>{{/if}}
        {{#if (has-block 'action')}}<div class='pretui-alert-action'>{{yield to='action'}}</div>{{/if}}
      </div>
    </div>
    <style scoped>
      .pretui-alert {
        display: flex;
        gap: 9px;
        padding: 8px 10px;
        border-radius: 10px;
        background: color-mix(in oklch, var(--pretui-alert-hue, var(--chart-1)) var(--pretui-chip-mix, 20%), var(--card));
        color: color-mix(in oklch, var(--foreground) 40%, var(--pretui-alert-hue, var(--chart-1)));
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--pretui-alert-hue, var(--chart-1)) 25%, var(--border));
        font-size: var(--text-ui-md, 12.5px);
      }
      .pretui-alert-glyph {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        flex: none;
        display: grid;
        place-items: center;
        font-size: 9px;
        font-weight: 700;
        background: var(--pretui-alert-hue, var(--chart-1));
        color: var(--pretui-on-neutral, var(--boxel-light));
        margin-top: 1px;
      }
      .pretui-alert-body {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .pretui-alert-title {
        font-weight: 600;
        color: color-mix(in oklch, var(--foreground) 55%, var(--pretui-alert-hue, var(--chart-1)));
      }
      .pretui-alert-action {
        margin-top: 4px;
      }
    </style>
  </template>
}

export interface ToastSignature {
  Args: {
    title: string;
    message?: string;
    /** alias — Sonner / shadcn / Mantine all call the second line
     * `description`. Resolved in the template because this component is
     * template-only; the `{{else if}}` chain is the getter's equivalent. */
    description?: string;
  };
  Blocks: { icon: []; action: [] };
  Element: HTMLDivElement;
}

export const Toast: TemplateOnlyComponent<ToastSignature> = <template>
  <div class='pretui-toast' role='status' data-test-pretui-toast ...attributes>
    {{#if (has-block 'icon')}}{{yield to='icon'}}{{/if}}
    <div class='pretui-toast-body'>
      <div class='pretui-toast-title'>{{@title}}</div>
      {{#if @message}}<div class='pretui-toast-msg'>{{@message}}</div>
      {{else if @description}}<div
          class='pretui-toast-msg'
        >{{@description}}</div>{{/if}}
    </div>
    {{#if (has-block 'action')}}<div class='pretui-toast-action'>{{yield to='action'}}</div>{{/if}}
  </div>
  <style scoped>
    .pretui-toast {
      display: flex;
      align-items: center;
      gap: 9px;
      /* kit stacking scale (pretui-css.gts): a toast reports something that
         just happened and must stay readable over whatever is open, so it is
         the one tier deliberately above `dialog`. `relative` is what makes
         the z-index apply — the toast is otherwise in flow and its consumer
         owns where it sits. */
      position: relative;
      z-index: var(--pretui-z-toast, 100);
      background: var(--popover);
      border-radius: 10px;
      box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border), 0 2px 10px rgb(0 0 0 / 0.08));
      padding: 7px 10px;
      font-size: var(--text-ui-md, 12.5px);
      width: max-content;
      max-width: 360px;
    }
    .pretui-toast-body {
      display: grid;
      gap: 1px;
      min-width: 0;
    }
    .pretui-toast-title {
      font-weight: 600;
    }
    .pretui-toast-msg {
      color: var(--muted-foreground);
      font-size: var(--text-ui-sm, 11.5px);
    }
    .pretui-toast-action {
      margin-left: 8px;
      flex: none;
    }
  </style>
</template>;

export interface ProgressBarSignature {
  Args: {
    value: number;
    max?: number;
    label?: string;
    count?: string;
    steps?: boolean;
  };
  Element: HTMLDivElement;
}

// Quantitative completion. Stepped mode for small discrete totals ("3 / 6").
export class ProgressBar extends Component<ProgressBarSignature> {
  get max() {
    return this.args.max ?? 100;
  }
  get pct() {
    return Math.max(0, Math.min(100, (this.args.value / this.max) * 100));
  }
  get stepped() {
    return this.args.steps ?? (this.args.count !== undefined && this.max <= 12);
  }
  get countText() {
    return this.args.count ?? `${Math.round(this.pct)}%`;
  }
  get fillStyle() {
    return htmlSafe(`width: ${this.pct}%; min-width: ${this.pct > 0 ? 4 : 0}px`);
  }
  get stepList(): { on: boolean }[] {
    let out = [];
    for (let i = 0; i < this.max; i++) {
      out.push({ on: i < this.args.value });
    }
    return out;
  }
  get showHeader() {
    return this.args.label || this.args.count !== undefined;
  }
  <template>
    <div class='pretui-progresswrap' data-test-pretui-progress ...attributes>
      {{#if this.showHeader}}
        <div class='pretui-progress-head'>
          <span>{{@label}}</span>
          <span class='pretui-progress-count'>{{this.countText}}</span>
        </div>
      {{/if}}
      {{#if this.stepped}}
        <div role='progressbar' aria-valuenow={{@value}} aria-valuemax={{this.max}} class='pretui-progress-steps'>
          {{#each this.stepList as |s|}}
            <span class='pretui-progress-step' data-on={{if s.on 'true'}}></span>
          {{/each}}
        </div>
      {{else}}
        <div class='pretui-progress' role='progressbar' aria-valuenow={{@value}} aria-valuemax={{this.max}}>
          <div class='pretui-progress-fill' style={{this.fillStyle}}></div>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .pretui-progresswrap {
        display: grid;
        gap: 5px;
      }
      .pretui-progress-head {
        display: flex;
        justify-content: space-between;
        align-items: last baseline;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .pretui-progress-count {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        color: var(--foreground);
      }
      .pretui-progress {
        height: 4px;
        border-radius: 2px;
        background: var(--inset, var(--boxel-100));
        overflow: hidden;
      }
      .pretui-progress-fill {
        height: 100%;
        border-radius: 2px;
        background: var(--primary);
        transition: width var(--pretui-dur-morph, 300ms) var(--pretui-ease-morph, ease);
      }
      .pretui-progress-steps {
        display: flex;
        gap: 3px;
      }
      .pretui-progress-step {
        flex: 1;
        height: 4px;
        border-radius: 2px;
        background: var(--inset, var(--boxel-100));
        transition: background var(--pretui-dur-morph, 300ms) var(--pretui-ease-morph, ease);
      }
      .pretui-progress-step[data-on] {
        background: var(--primary);
      }
    </style>
  </template>
}

// Spinner and ProgressRadial take `@size` in PIXELS — they are drawn boxes,
// not em-scaled controls. An agent reaching for the kit's scale writes
// `@size='sm'` and used to get `width: smpx`, i.e. a size declaration the
// browser drops on the floor with no error anywhere. The house enum now
// resolves to the pixel step it names; a raw number still wins.
const RADIAL_PX: Record<PretuiSize, number> = {
  xs: 16,
  s: 22,
  m: 28,
  l: 36,
  xl: 48,
};
const SPINNER_PX: Record<PretuiSize, number> = {
  xs: 9,
  s: 11,
  m: 13,
  l: 17,
  xl: 22,
};

/** A `@size` that may be a raw pixel number or any spelling of the scale. */
export function resolvePixelSize(
  size: number | string | undefined,
  scale: Record<PretuiSize, number>,
  fallback: PretuiSize = 'm',
): number {
  if (typeof size === 'number') {
    return size;
  }
  return scale[resolveSize(size, fallback)];
}

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

export interface BrokenLinkSignature {
  Args: { label?: string; refId?: string };
  Element: HTMLSpanElement;
}

// An honest "this reference is gone" (Boxel-specific obligation).
export class BrokenLink extends Component<BrokenLinkSignature> {
  get label() {
    return this.args.label ?? 'missing card';
  }
  <template>
    <span class='pretui-broken' title='This reference is gone' data-test-pretui-broken-link ...attributes>
      <svg width='11' height='11' viewBox='0 0 12 12' aria-hidden='true'><path d='M4.5 7.5 2.8 9.2a1.7 1.7 0 0 1-2.4-2.4L2.8 4.4M7.5 4.5l1.7-1.7a1.7 1.7 0 0 1 2.4 2.4L9.2 7.6M1 1l10 10' fill='none' stroke='currentColor' stroke-width='1.3' stroke-linecap='round' /></svg>
      <span>{{this.label}}</span>
      {{#if @refId}}<span class='pretui-broken-id'>{{@refId}}</span>{{/if}}
    </span>
    <style scoped>
      .pretui-broken {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px;
        border-radius: 6px;
        background: var(--inset, var(--boxel-100));
        color: var(--ink-3, var(--boxel-400));
        font-size: var(--text-ui-sm, 11.5px);
        font-family: var(--font-mono);
        outline: 1px dashed var(--line-strong, var(--boxel-400));
        outline-offset: -1px;
        text-decoration: line-through;
        text-decoration-color: color-mix(in oklch, var(--ink-3, var(--boxel-400)) 50%, transparent);
      }
      .pretui-broken svg {
        flex: none;
      }
      .pretui-broken-id {
        opacity: 0.7;
      }
    </style>
  </template>
}

export interface LoadingStateSignature {
  Args: {
    label?: string;
    variant?: 'drive' | 'dots' | 'orbit';
    // caller-supplied elapsed text ("4.2s") — realm components own no timers
    elapsed?: string;
  };
  Element: HTMLSpanElement;
}

// Adopted from Beautiful UI: pixel-grid loader + shimmer label (+ elapsed).
export class LoadingState extends Component<LoadingStateSignature> {
  get label() {
    return this.args.label ?? 'Working';
  }
  get pixels(): { style: ReturnType<typeof htmlSafe>; round: boolean }[] {
    let variant = this.args.variant ?? 'drive';
    let chev = Array.from({ length: 9 }, (_, i) => {
      let r = Math.floor(i / 3);
      let c = i % 3;
      return (c + Math.abs(r - 1)) * 90;
    });
    let order = [0, 1, 2, 5, 8, 7, 6, 3];
    let orbit = Array.from({ length: 9 }, (_, i) => {
      let k = order.indexOf(i);
      return k === -1 ? null : k * 110;
    });
    let delays = variant === 'orbit' ? orbit : chev;
    let dur = variant === 'orbit' ? 950 : 650;
    let round = variant === 'dots';
    return delays.map((d) => ({
      round,
      style: htmlSafe(
        d === null
          ? 'opacity: .07; animation: none'
          : `animation: pretui-pixel-on ${dur}ms ease-in-out ${d}ms infinite`,
      ),
    }));
  }
  <template>
    <span class='pretui-loading' role='status' data-test-pretui-loading-state ...attributes>
      <span aria-hidden='true' class='pretui-pixelgrid'>
        {{#each this.pixels as |p|}}
          <span class='pretui-pixel' data-round={{if p.round 'true'}} style={{p.style}}></span>
        {{/each}}
      </span>
      <span class='pretui-shimmer-label'>{{this.label}}</span>
      {{#if @elapsed}}<span class='pretui-elapsed'>{{@elapsed}}</span>{{/if}}
    </span>
    <style scoped>
      @keyframes pretui-pixel-on {
        0%,
        100% {
          opacity: 0.15;
        }
        50% {
          opacity: 1;
        }
      }
      @keyframes pretui-shimmer-text {
        from {
          background-position: 200% 0;
        }
        to {
          background-position: -200% 0;
        }
      }
      .pretui-loading {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }
      .pretui-pixelgrid {
        display: grid;
        grid-template-columns: repeat(3, 4px);
        gap: 1.5px;
      }
      .pretui-pixel {
        width: 4px;
        height: 4px;
        background: var(--foreground);
        border-radius: 1px;
        opacity: 0.15;
      }
      .pretui-pixel[data-round] {
        border-radius: 50%;
      }
      .pretui-shimmer-label {
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 500;
        background-image: linear-gradient(90deg, var(--ink-3, var(--boxel-400)) 35%, var(--foreground) 50%, var(--ink-3, var(--boxel-400)) 65%);
        background-size: 200% 100%;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        animation: pretui-shimmer-text 1.4s linear infinite;
        white-space: nowrap;
      }
      .pretui-elapsed {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--ink-3, var(--boxel-400));
        font-variant-numeric: tabular-nums;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-pixel {
          animation: none !important;
          opacity: 0.6;
        }
        .pretui-shimmer-label {
          animation: none;
          color: var(--muted-foreground);
          background: none;
        }
      }
    </style>
  </template>
}

// Other kits' names for the same components: Tremor / Web Awesome Callout,
// shadcn / Mantine Loader, MUI Snackbar.
export { Alert as Callout, Spinner as Loader, Toast as Snackbar };
