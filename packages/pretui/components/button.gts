// Button: a native <button> on the two-axis treatment grid (@tone × @appearance),
// em-scaled, with a built-in busy state. Everything that performs an action wraps it.
import Component from '@glimmer/component';
import {
  PRETUI_APPEARANCES,
  PRETUI_TONES,
  firstDefined,
  resolveSize,
  resolveTone,
} from '../pretui-primitives';
import type {
  PretuiAppearance,
  PretuiSize,
  PretuiSizeArg,
  PretuiTone,
  PretuiToneArg,
} from '../pretui-primitives';

// @variant is the single-axis spelling (boxel-ui, shadcn, Mantine) resolved onto the two axes.
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'destructive'
  | 'default'
  | 'outline'
  | 'outlined'
  | 'subtle'
  | 'filled'
  | 'link';
const DEFAULT_AXES: [PretuiTone, PretuiAppearance] = ['primary', 'accent'];
// Null-prototype so a variant like 'constructor' misses the table instead of hitting Object.prototype.
const VARIANT_AXES: Record<string, [PretuiTone, PretuiAppearance]> =
  Object.assign(
    Object.create(null) as Record<string, [PretuiTone, PretuiAppearance]>,
    {
      primary: ['primary', 'accent'],
      secondary: ['neutral', 'outlined'],
      ghost: ['neutral', 'plain'],
      destructive: ['danger', 'accent'],
      default: ['primary', 'accent'],
      outline: ['neutral', 'outlined'],
      outlined: ['neutral', 'outlined'],
      subtle: ['neutral', 'plain'],
      filled: ['primary', 'accent'],
      link: ['primary', 'plain'],
    } as Record<string, [PretuiTone, PretuiAppearance]>,
  );

export interface ButtonSignature {
  Args: {
    /** single-axis alias over @tone + @appearance — the boxel-ui / shadcn spelling */
    variant?: ButtonVariant;
    tone?: PretuiToneArg;
    appearance?: PretuiAppearance;
    size?: PretuiSizeArg;
    busy?: boolean;
    disabled?: boolean;
    /** alias — React Aria / Base UI spelling of @disabled */
    isDisabled?: boolean;
    /** aliases — shadcn/MUI `loading`, Aria's `isPending`, of @busy */
    loading?: boolean;
    isLoading?: boolean;
    isPending?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLButtonElement;
}

export class Button extends Component<ButtonSignature> {
  private get axes(): [PretuiTone, PretuiAppearance] {
    return VARIANT_AXES[this.args.variant ?? 'primary'] ?? DEFAULT_AXES;
  }
  get tone(): PretuiTone {
    return resolveTone(this.args.tone, PRETUI_TONES, this.axes[0]);
  }
  get appearance(): PretuiAppearance {
    let appearance = this.args.appearance;
    return appearance &&
      (PRETUI_APPEARANCES as readonly string[]).includes(appearance)
      ? appearance
      : this.axes[1];
  }
  get size(): PretuiSize {
    return resolveSize(this.args.size);
  }
  get busy() {
    return (
      firstDefined(
        this.args.busy,
        this.args.loading,
        this.args.isLoading,
        this.args.isPending,
      ) ?? false
    );
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get isDisabled() {
    return this.disabled || this.busy;
  }
  <template>
    <button
      type='button'
      class='pretui-btn'
      data-tone={{this.tone}}
      data-appearance={{this.appearance}}
      data-size={{this.size}}
      data-state={{if this.busy 'busy'}}
      disabled={{this.isDisabled}}
      aria-busy={{if this.busy 'true'}}
      data-test-pretui-button
      ...attributes
    >
      {{#if this.busy}}<span class='pretui-spinner'></span>{{/if}}
      <span class='pretui-btn-label'>{{yield}}</span>
    </button>
    <style scoped>
      .pretui-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.48em;
        height: var(--pretui-button-h, 2.24em);
        padding: 0 var(--pretui-button-px, 0.96em);
        border: 0;
        border-radius: var(--pretui-button-radius, var(--radius));
        font-family: inherit;
        font-size: var(--pretui-size-m, var(--text-ui-md, 0.78rem));
        font-weight: 500;
        letter-spacing: var(--track-ui, 0.01em);
        cursor: pointer;
        white-space: nowrap;
        transition:
          background var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease),
          box-shadow var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease),
          transform 80ms ease;
      }
      .pretui-btn:active {
        transform: translateY(0.5px);
      }
      /* the appearances paint their own box-shadow, which hides the UA focus ring */
      .pretui-btn:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .pretui-btn:disabled {
        opacity: 0.45;
        cursor: default;
        transform: none;
      }
      /* size scale — font-size only; internals ride the em */
      .pretui-btn[data-size='xs'] {
        font-size: var(--pretui-size-xs, var(--text-ui-xs, 0.66rem));
      }
      .pretui-btn[data-size='s'] {
        font-size: var(--pretui-size-s, var(--text-ui-sm, 0.72rem));
      }
      .pretui-btn[data-size='l'] {
        font-size: var(--pretui-size-l, var(--text-ui-lg, 0.875rem));
      }
      .pretui-btn[data-size='xl'] {
        font-size: var(--pretui-size-xl, var(--text-ui-xl, 1rem));
      }
      /* tone map — each tone only sets custom properties */
      .pretui-btn[data-tone='neutral'] {
        --pretui-tone: var(--foreground);
        --pretui-tone-on: var(--pretui-on-neutral, var(--background));
        --pretui-btn-hairline: var(--border);
        --pretui-btn-shadow: var(
          --pretui-shadow-control,
          0 0 0 1px var(--border)
        );
        --pretui-btn-ink: var(--foreground);
        --pretui-btn-ink-quiet: var(--muted-foreground);
      }
      .pretui-btn[data-tone='primary'] {
        --pretui-tone: var(--primary);
        --pretui-tone-on: var(--primary-foreground);
      }
      .pretui-btn[data-tone='info'] {
        --pretui-tone: var(--pretui-info, var(--boxel-blue));
        --pretui-tone-on: var(--pretui-on-info, var(--background));
      }
      .pretui-btn[data-tone='success'] {
        --pretui-tone: var(--success, var(--boxel-success));
        --pretui-tone-on: var(--pretui-on-success, var(--background));
      }
      .pretui-btn[data-tone='warning'] {
        --pretui-tone: var(--warning, var(--boxel-warning));
        --pretui-tone-on: var(--pretui-on-warning, var(--background));
      }
      .pretui-btn[data-tone='danger'] {
        --pretui-tone: var(--destructive);
        --pretui-tone-on: var(--destructive-foreground);
      }
      .pretui-btn[data-tone='attention'] {
        --pretui-tone: var(--pretui-attention, var(--boxel-fuschia));
        --pretui-tone-on: var(--pretui-on-attention, var(--background));
      }
      /* appearance recipes — written once, read the tone vars */
      .pretui-btn[data-appearance='accent'] {
        background: var(--pretui-button-bg, var(--pretui-tone));
        color: var(--pretui-button-fg, var(--pretui-tone-on));
        box-shadow:
          0 0 0 1px
            color-mix(
              in oklch,
              var(--pretui-button-bg, var(--pretui-tone)) 70%,
              var(--border)
            ),
          var(--pretui-edge-highlight, inset 0 1px 0 rgb(255 255 255 / 0.14)),
          var(--shadow-2xs);
      }
      .pretui-btn[data-appearance='accent']:hover:not(:disabled) {
        background: color-mix(
          in oklch,
          var(--foreground) 10%,
          var(--pretui-button-bg, var(--pretui-tone))
        );
      }
      .pretui-btn[data-appearance='filled'] {
        background: color-mix(in oklch, var(--pretui-tone) 15%, var(--card));
        color: var(
          --pretui-btn-ink,
          color-mix(in oklch, var(--pretui-tone) 60%, var(--card-foreground))
        );
      }
      .pretui-btn[data-appearance='filled']:hover:not(:disabled) {
        background: color-mix(in oklch, var(--pretui-tone) 22%, var(--card));
      }
      .pretui-btn[data-appearance='outlined'] {
        background: var(--pretui-button-secondary-bg, transparent);
        color: var(
          --pretui-btn-ink,
          color-mix(in oklch, var(--pretui-tone) 55%, var(--foreground))
        );
        box-shadow: var(
          --pretui-btn-shadow,
          0 0 0 1px color-mix(in oklch, var(--pretui-tone) 45%, var(--border))
        );
      }
      .pretui-btn[data-appearance='outlined']:hover:not(:disabled) {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-btn[data-appearance='filled-outlined'] {
        background: color-mix(in oklch, var(--pretui-tone) 12%, var(--card));
        color: var(
          --pretui-btn-ink,
          color-mix(in oklch, var(--pretui-tone) 60%, var(--card-foreground))
        );
        box-shadow: 0 0 0 1px
          var(
            --pretui-btn-hairline,
            color-mix(in oklch, var(--pretui-tone) 40%, var(--border))
          );
      }
      .pretui-btn[data-appearance='filled-outlined']:hover:not(:disabled) {
        background: color-mix(in oklch, var(--pretui-tone) 20%, var(--card));
      }
      .pretui-btn[data-appearance='plain'] {
        background: transparent;
        color: var(
          --pretui-btn-ink-quiet,
          color-mix(in oklch, var(--pretui-tone) 40%, var(--muted-foreground))
        );
        box-shadow: none;
      }
      .pretui-btn[data-appearance='plain']:hover:not(:disabled) {
        background: var(--hover, var(--boxel-100));
        color: var(
          --pretui-btn-ink,
          color-mix(in oklch, var(--pretui-tone) 30%, var(--foreground))
        );
      }
      .pretui-btn[data-state='busy'] {
        pointer-events: none;
      }
      .pretui-btn[data-state='busy'] .pretui-btn-label {
        opacity: 0.6;
      }
      @keyframes pretui-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .pretui-spinner {
        width: 1.04em;
        height: 1.04em;
        border-radius: 50%;
        border: 1.5px solid color-mix(in oklch, currentColor 25%, transparent);
        border-top-color: currentColor;
        animation: pretui-spin 0.7s linear infinite;
        flex: none;
      }
    </style>
  </template>
}
