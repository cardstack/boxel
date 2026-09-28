// Button: a native <button> on the two-axis treatment grid (@tone × @appearance),
// em-scaled, with a built-in busy state. Everything that performs an action wraps it.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
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

// @variant is the single-axis spelling, resolved onto the two axes.
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
    /** single-axis alias over @tone + @appearance */
    variant?: ButtonVariant;
    tone?: PretuiToneArg;
    appearance?: PretuiAppearance;
    size?: PretuiSizeArg;
    busy?: boolean;
    /** added to the accessible name while busy, for when the visible label
     *  doesn't say so itself (e.g. 'Save' → 'Save, saving') */
    busyLabel?: string;
    disabled?: boolean;
    /** alias of @disabled */
    isDisabled?: boolean;
    /** aliases of @busy */
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
  // Busy keeps the button focusable (aria-disabled, not native disabled), so
  // activation is blocked here instead. Never both attributes at once.
  get ariaDisabled() {
    return this.busy && !this.disabled ? 'true' : undefined;
  }
  // Capture phase on the button itself runs before the caller's own click
  // listeners, and preventDefault stops a type='submit' from submitting.
  blockWhileBusy = (event: Event) => {
    if (this.ariaDisabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  <template>
    <button
      type='button'
      class='pretui-btn'
      data-tone={{this.tone}}
      data-appearance={{this.appearance}}
      data-size={{this.size}}
      data-state={{if this.busy 'busy'}}
      disabled={{this.disabled}}
      aria-disabled={{this.ariaDisabled}}
      aria-busy={{if this.busy 'true'}}
      {{on 'click' this.blockWhileBusy capture=true}}
      data-test-pretui-button
      ...attributes
    >
      {{#if this.busy}}<span
          class='pretui-spinner'
          aria-hidden='true'
          data-test-pretui-button-spinner
        ></span>{{/if}}
      <span class='pretui-btn-label'>{{yield}}</span>
      {{! always rendered, so the busy text lands in an existing node }}
      <span class='pretui-btn-sr' data-test-pretui-button-busy-label>{{if
          this.busy
          @busyLabel
        }}</span>
    </button>
    <style scoped>
      /* layered, so a caller's plain CSS wins without fighting specificity */
      @layer Component {
        /* Each appearance only sets --pretui-btn-surface/-text/-edge (plus
           their -hover twins); the rules below are the only ones that paint.
           One border carries the edge, so fill and edge change together. */
        .pretui-btn {
          /* hover tints: the tone pulled toward --foreground, so a light tone
             (warning, a mint primary) still reads on a light card, and a dark
             one on a dark card */
          --pretui-btn-tint: color-mix(
            in oklch,
            var(--pretui-tone) 70%,
            var(--foreground)
          );

          --pretui-btn-surface: initial;
          --pretui-btn-surface-hover: initial;
          --pretui-btn-text: initial;
          --pretui-btn-text-hover: initial;
          --pretui-btn-edge: initial;
          --pretui-btn-edge-hover: initial;
          --pretui-btn-elevation: initial;

          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.48em;
          min-height: var(--pretui-button-h, 2.24em);
          padding: 0.2em var(--pretui-button-px, 0.96em);
          border: 1px solid var(--pretui-btn-edge, transparent);
          border-radius: var(
            --pretui-button-radius,
            var(--boxel-border-radius-sm)
          );
          background: var(--pretui-btn-surface, transparent);
          color: var(--pretui-btn-text, inherit);
          box-shadow: var(--pretui-btn-elevation, none);
          font-family: inherit;
          font-size: var(--pretui-size-m, var(--text-ui-md, 0.78rem));
          font-weight: 500;
          letter-spacing: var(--track-ui, 0.01em);
          cursor: pointer;
          white-space: nowrap;
          transition:
            background var(--pretui-dur-snap, 180ms)
              var(--pretui-ease-snap, ease),
            border-color var(--pretui-dur-snap, 180ms)
              var(--pretui-ease-snap, ease),
            color var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease),
            transform 80ms ease;
        }
        @media (hover: hover) {
          .pretui-btn:hover:not(:disabled, [aria-disabled='true']) {
            background: var(
              --pretui-btn-surface-hover,
              var(--pretui-btn-surface, transparent)
            );
            border-color: var(
              --pretui-btn-edge-hover,
              var(--pretui-btn-edge, transparent)
            );
            color: var(
              --pretui-btn-text-hover,
              var(--pretui-btn-text, inherit)
            );
          }
        }
        .pretui-btn:active:not(:disabled, [aria-disabled='true']) {
          transform: translateY(0.5px);
        }
        .pretui-btn:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-btn:disabled {
          opacity: 0.45;
          cursor: default;
        }
        /* size scale — font-size only; internals ride the em */
        .pretui-btn[data-size='xs'] {
          font-size: var(--pretui-size-xs, var(--text-ui-xs, 0.66rem));
          /* keeps the 24px minimum target when the theme's xs step is small */
          min-height: max(var(--pretui-button-h, 2.24em), 1.5rem);
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
          --pretui-tone-on: var(--background);
          --pretui-btn-hairline: var(--border);
          --pretui-btn-ink: var(--foreground);
          --pretui-btn-ink-quiet: color-mix(
            in oklch,
            var(--muted-foreground) 55%,
            var(--foreground)
          );
          /* the accent fill IS --foreground, so mixing it in changes nothing */
          --pretui-btn-accent-hover: color-mix(
            in oklch,
            var(--pretui-tone-on) 30%,
            var(--pretui-button-bg, var(--pretui-tone))
          );
        }
        .pretui-btn[data-tone='primary'] {
          --pretui-tone: var(--primary);
          --pretui-tone-on: var(--primary-foreground);
        }
        .pretui-btn[data-tone='info'] {
          --pretui-tone: var(--info);
          --pretui-tone-on: var(--info-foreground);
        }
        .pretui-btn[data-tone='success'] {
          --pretui-tone: var(--success);
          --pretui-tone-on: var(--success-foreground);
        }
        .pretui-btn[data-tone='warning'] {
          --pretui-tone: var(--warning);
          --pretui-tone-on: var(--warning-foreground);
        }
        .pretui-btn[data-tone='danger'] {
          --pretui-tone: var(--destructive);
          --pretui-tone-on: var(--destructive-foreground);
        }
        .pretui-btn[data-tone='attention'] {
          --pretui-tone: var(--attention);
          --pretui-tone-on: var(--attention-foreground);
        }
        /* appearance recipes — written once, read the tone vars */
        .pretui-btn[data-appearance='accent'] {
          --pretui-btn-surface: var(--pretui-button-bg, var(--pretui-tone));
          --pretui-btn-surface-hover: var(
            --pretui-btn-accent-hover,
            color-mix(
              in oklch,
              var(--foreground) 10%,
              var(--pretui-button-bg, var(--pretui-tone))
            )
          );
          --pretui-btn-text: var(--pretui-button-fg, var(--pretui-tone-on));
          --pretui-btn-elevation: var(--shadow-2xs);
        }
        .pretui-btn[data-appearance='filled'] {
          --pretui-btn-surface: color-mix(
            in oklch,
            var(--pretui-tone) 15%,
            var(--background)
          );
          --pretui-btn-surface-hover: color-mix(
            in oklch,
            var(--pretui-btn-tint) 22%,
            var(--background)
          );
          --pretui-btn-text: var(
            --pretui-btn-ink,
            color-mix(in oklch, var(--pretui-tone) 60%, var(--foreground))
          );
          --pretui-btn-text-hover: var(
            --pretui-btn-ink,
            color-mix(in oklch, var(--pretui-tone) 40%, var(--foreground))
          );
        }
        .pretui-btn[data-appearance='outlined'] {
          --pretui-btn-surface: var(--pretui-button-secondary-bg, transparent);
          --pretui-btn-surface-hover: color-mix(
            in oklch,
            var(--pretui-btn-tint) 18%,
            var(--pretui-button-secondary-bg, transparent)
          );
          --pretui-btn-edge: var(
            --pretui-btn-hairline,
            color-mix(in oklch, var(--pretui-tone) 45%, var(--border))
          );
          --pretui-btn-text: var(
            --pretui-btn-ink,
            color-mix(in oklch, var(--pretui-tone) 55%, var(--foreground))
          );
        }
        .pretui-btn[data-appearance='filled-outlined'] {
          --pretui-btn-surface: color-mix(
            in oklch,
            var(--pretui-tone) 12%,
            var(--background)
          );
          --pretui-btn-surface-hover: color-mix(
            in oklch,
            var(--pretui-btn-tint) 20%,
            var(--background)
          );
          --pretui-btn-edge: var(
            --pretui-btn-hairline,
            color-mix(in oklch, var(--pretui-tone) 40%, var(--border))
          );
          --pretui-btn-text: var(
            --pretui-btn-ink,
            color-mix(in oklch, var(--pretui-tone) 60%, var(--foreground))
          );
          --pretui-btn-text-hover: var(
            --pretui-btn-ink,
            color-mix(in oklch, var(--pretui-tone) 40%, var(--foreground))
          );
        }
        .pretui-btn[data-appearance='plain'] {
          --pretui-btn-surface-hover: color-mix(
            in oklch,
            var(--pretui-btn-tint) 18%,
            transparent
          );
          --pretui-btn-text: var(
            --pretui-btn-ink-quiet,
            color-mix(in oklch, var(--pretui-tone) 40%, var(--foreground))
          );
          --pretui-btn-text-hover: var(
            --pretui-btn-ink,
            color-mix(in oklch, var(--pretui-tone) 30%, var(--foreground))
          );
        }
        .pretui-btn[data-state='busy'] {
          cursor: progress;
        }
        .pretui-btn[data-state='busy'] .pretui-btn-label {
          opacity: 0.6;
        }
        .pretui-btn-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
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
        @media (prefers-reduced-motion: reduce) {
          .pretui-spinner {
            animation-duration: 1.6s;
          }
          .pretui-btn:active:not(:disabled, [aria-disabled='true']) {
            transform: none;
          }
        }
        /* forced colors drop backgrounds and shadows; the border above stays,
           and disabled needs a cue beyond opacity */
        @media (forced-colors: active) {
          .pretui-btn:disabled,
          .pretui-btn[aria-disabled='true'] {
            color: GrayText;
            border-color: GrayText;
          }
        }
      }
    </style>
  </template>
}
