// Button: a native <button> on the two-axis treatment grid (@tone × @appearance),
// em-scaled, with a built-in busy state. Everything that performs an action wraps it.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
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
      link: ['primary', 'link'],
    } as Record<string, [PretuiTone, PretuiAppearance]>,
  );

// Picks what a busy button shows, without ever changing its width: the
// spinner with @busyLabel when that fits, else the spinner beside the dimmed
// label when that fits (a stretched or min-width button), else the spinner
// alone over the hidden label. Measured with the layout attribute cleared, so
// the chosen layout can't widen the button and feed back into the check.
// The busy label is an argument only so that changing it while busy re-runs
// the measurement; the text itself is read from the DOM.
const fitBusyContent = modifier(
  (busyEl: HTMLElement, [busy, _busyLabel]: [boolean, string | undefined]) => {
    let button = busyEl.parentElement;
    let label = busyEl.previousElementSibling as HTMLElement | null;
    let text = busyEl.lastElementChild as HTMLElement | null;
    if (!button || !label || !text) return;
    if (!busy) {
      button.removeAttribute('data-busy-layout');
      return;
    }
    let target = button;
    let labelEl = label;
    let textEl = text;
    let measure = () => {
      target.removeAttribute('data-busy-layout');
      let style = getComputedStyle(target);
      let room =
        target.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        0.5;
      // spinner 1.04em + gap 0.48em, as in the styles below
      let spinner = parseFloat(style.fontSize) * 1.52;
      // the busy text is visually hidden here, so scrollWidth is its full width
      let textWidth = textEl.textContent?.trim() ? textEl.scrollWidth : 0;
      if (textWidth && room >= textWidth + spinner) {
        target.setAttribute('data-busy-layout', 'text');
      } else if (room >= labelEl.offsetWidth + spinner) {
        target.setAttribute('data-busy-layout', 'inline');
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    let observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => {
      observer.disconnect();
      target.removeAttribute('data-busy-layout');
    };
  },
);

export const BUTTON_SHAPES = ['rounded', 'pill', 'square'] as const;
export type ButtonShape = (typeof BUTTON_SHAPES)[number];

export interface ButtonSignature {
  Args: {
    /** single-axis alias over @tone + @appearance */
    variant?: ButtonVariant;
    tone?: PretuiToneArg;
    appearance?: PretuiAppearance;
    size?: PretuiSizeArg;
    busy?: boolean;
    /** added after the visible label in the accessible name while busy, for
     *  when the label doesn't say so itself (e.g. 'Save' → 'Save Saving') */
    busyLabel?: string;
    disabled?: boolean;
    /** renders an <a> that looks like this button; @busy does not apply */
    href?: string;
    /** corner treatment; 'rounded' (default) is the theme's --radius less 2px */
    shape?: ButtonShape;
    /** alias of @disabled */
    isDisabled?: boolean;
    /** aliases of @busy */
    loading?: boolean;
    isLoading?: boolean;
    isPending?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

// The alias resolution, shared with the components that wrap Button and
// need the same answer before they hand the arguments on.
export function resolveBusy(args: ButtonSignature['Args']): boolean {
  return (
    firstDefined(args.busy, args.loading, args.isLoading, args.isPending) ??
    false
  );
}
export function resolveDisabled(args: ButtonSignature['Args']): boolean {
  return firstDefined(args.disabled, args.isDisabled) ?? false;
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
  get shape(): ButtonShape {
    let shape = this.args.shape;
    return shape && (BUTTON_SHAPES as readonly string[]).includes(shape)
      ? shape
      : 'rounded';
  }
  get busy() {
    return resolveBusy(this.args);
  }
  get disabled() {
    return resolveDisabled(this.args);
  }
  // Busy keeps the button focusable (aria-disabled, not native disabled), so
  // activation is blocked here instead. Never both attributes at once.
  get ariaDisabled() {
    return this.busy && !this.disabled ? 'true' : undefined;
  }
  // Capture phase on the element itself runs before the caller's own click
  // listeners, and preventDefault stops a type='submit' from submitting.
  blockWhileBusy = (event: Event) => {
    if (this.ariaDisabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  // An <a> has no disabled state: a disabled link loses its href (so it no
  // longer navigates) and swallows clicks the same way.
  blockWhileDisabled = (event: Event) => {
    if (this.disabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  <template>
    {{#if @href}}
      <a
        class='pretui-btn'
        href={{unless this.disabled @href}}
        role={{if this.disabled 'link'}}
        aria-disabled={{if this.disabled 'true'}}
        data-tone={{this.tone}}
        data-appearance={{this.appearance}}
        data-size={{this.size}}
        data-shape={{this.shape}}
        {{on 'click' this.blockWhileDisabled capture=true}}
        data-test-pretui-button
        ...attributes
      ><span class='pretui-btn-label'>{{yield}}</span></a>
    {{else}}
      <button
        type='button'
        class='pretui-btn'
        data-tone={{this.tone}}
        data-appearance={{this.appearance}}
        data-size={{this.size}}
        data-state={{if this.busy 'busy'}}
        data-shape={{this.shape}}
        disabled={{this.disabled}}
        aria-disabled={{this.ariaDisabled}}
        aria-busy={{if this.busy 'true'}}
        {{on 'click' this.blockWhileBusy capture=true}}
        data-test-pretui-button
        ...attributes
      >
        <span class='pretui-btn-label'>{{yield}}</span>
        {{! after the label, so the accessible name starts with the visible
            label (WCAG 2.5.3); CSS order puts the spinner first visually }}
        <span class='pretui-btn-busy' {{fitBusyContent this.busy @busyLabel}}>
          {{#if this.busy}}<span
              class='pretui-spinner'
              aria-hidden='true'
              data-test-pretui-button-spinner
            ></span>{{/if}}
          {{! always rendered, so the busy text lands in an existing node }}
          <span
            class='pretui-btn-busy-text'
            data-test-pretui-button-busy-label
          >{{if this.busy @busyLabel}}</span>
        </span>
      </button>
    {{/if}}
    <style scoped>
      /* layered, so a caller's plain CSS wins without fighting specificity */
      @layer PretComponent {
        /* Each appearance only sets --pretui-btn-surface/-text/-edge (plus
           their -hover twins); the rules below are the only ones that paint.
           One border carries the edge, so fill and edge change together. */
        .pretui-btn {
          /* hover tints: the tone's lightness pulled toward --foreground, so a
             light tone (warning, a mint primary) still reads on a light card
             and a dark one on a dark card; chroma is restored (the mix took
             30% of it) so the tint keeps the tone's hue instead of graying */
          --pretui-btn-tint: oklch(
            from color-mix(in oklch, var(--pretui-tone) 70%, var(--foreground))
              l calc(c / 0.7) h
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
          min-width: var(--pretui-button-min-w, 0);
          padding: 0.2em var(--pretui-button-px, 0.96em);
          border: 1px solid var(--pretui-btn-edge, transparent);
          /* a step below the theme's --radius, so a button nests inside a
             card or dialog of that radius */
          border-radius: var(--pretui-button-radius, calc(var(--radius) - 2px));
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
        .pretui-btn:disabled,
        a.pretui-btn[aria-disabled='true'] {
          opacity: 0.45;
          cursor: default;
        }
        a.pretui-btn {
          text-decoration: none;
        }
        .pretui-btn[data-shape='pill'] {
          border-radius: var(
            --pretui-button-radius,
            var(--boxel-border-radius-pill)
          );
        }
        .pretui-btn[data-shape='square'] {
          border-radius: var(--pretui-button-radius, 0);
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
        .pretui-btn[data-size='m'] {
          font-size: var(--pretui-size-m, var(--text-ui-md, 0.78rem));
        }
        .pretui-btn[data-size='l'] {
          font-size: var(--pretui-size-l, var(--text-ui-lg, 0.875rem));
        }
        .pretui-btn[data-size='xl'] {
          font-size: var(--pretui-size-xl, var(--text-ui-xl, 1rem));
        }
        /* tone map — each tone only sets custom properties */
        .pretui-btn[data-tone='neutral'] {
          --pretui-tone-ink: var(--foreground);
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
          --pretui-tone-ink: var(--primary-ink);
          --pretui-tone: var(--primary);
          --pretui-tone-on: var(--primary-foreground);
        }
        .pretui-btn[data-tone='info'] {
          --pretui-tone-ink: var(--info-ink);
          --pretui-tone: var(--info);
          --pretui-tone-on: var(--info-foreground);
        }
        .pretui-btn[data-tone='success'] {
          --pretui-tone-ink: var(--success-ink);
          --pretui-tone: var(--success);
          --pretui-tone-on: var(--success-foreground);
        }
        .pretui-btn[data-tone='warning'] {
          --pretui-tone-ink: var(--warning-ink);
          --pretui-tone: var(--warning);
          --pretui-tone-on: var(--warning-foreground);
        }
        .pretui-btn[data-tone='danger'] {
          --pretui-tone-ink: var(--destructive-ink);
          --pretui-tone: var(--destructive);
          --pretui-tone-on: var(--destructive-foreground);
        }
        .pretui-btn[data-tone='attention'] {
          --pretui-tone-ink: var(--attention-ink);
          --pretui-tone: var(--attention);
          --pretui-tone-on: var(--attention-foreground);
        }
        /* appearance recipes — written once, read the tone vars */
        .pretui-btn[data-appearance='accent'] {
          --pretui-btn-surface: var(--pretui-button-bg, var(--pretui-tone));
          /* a shade darker in both schemes; a mix toward --foreground would
             lighten the fill in dark mode instead */
          --pretui-btn-surface-hover: var(
            --pretui-btn-accent-hover,
            oklch(
              from var(--pretui-button-bg, var(--pretui-tone)) calc(l * 0.9) c h
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
            color-mix(in oklch, var(--pretui-tone) 45%, var(--foreground))
          );
          --pretui-btn-text-hover: var(
            --pretui-btn-ink,
            color-mix(in oklch, var(--pretui-tone) 35%, var(--foreground))
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
            color-mix(in oklch, var(--pretui-tone) 45%, var(--foreground))
          );
          --pretui-btn-text-hover: var(
            --pretui-btn-ink,
            color-mix(in oklch, var(--pretui-tone) 40%, var(--foreground))
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
            color-mix(in oklch, var(--pretui-tone) 45%, var(--foreground))
          );
          --pretui-btn-text-hover: var(
            --pretui-btn-ink,
            color-mix(in oklch, var(--pretui-tone) 35%, var(--foreground))
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
        /* a standalone text action: the tone's ink, no fill or edge, flush
           with surrounding text (inline padding 0) but still a full-height
           target; the underline marks hover and keyboard focus */
        .pretui-btn[data-appearance='link'] {
          --pretui-btn-text: var(--pretui-button-fg, var(--pretui-tone-ink));
          padding-inline: 0;
          text-underline-offset: 0.2em;
        }
        .pretui-btn[data-appearance='link']:focus-visible {
          text-decoration-line: underline;
        }
        @media (hover: hover) {
          .pretui-btn[data-appearance='link']:hover:not(
              :disabled,
              [aria-disabled='true']
            ) {
            text-decoration-line: underline;
          }
        }
        .pretui-btn[data-state='busy'] {
          cursor: progress;
        }
        /* Busy: the label keeps its box (and its place in the accessible
           name) and the busy layer sits on top of it, so the width never
           changes. fitBusyContent picks what the layer shows. */
        .pretui-btn[data-state='busy'] .pretui-btn-label {
          opacity: 0;
        }
        .pretui-btn-busy {
          position: absolute;
          inset: 0;
          display: none;
          align-items: center;
          justify-content: center;
          gap: 0.48em;
          pointer-events: none;
        }
        .pretui-btn[data-state='busy'] .pretui-btn-busy {
          display: flex;
        }
        /* room for the spinner beside the label: both in the row */
        .pretui-btn[data-busy-layout='inline'] .pretui-btn-busy {
          position: static;
          order: -1;
        }
        .pretui-btn[data-busy-layout='inline'] .pretui-btn-label {
          opacity: 0.6;
        }
        .pretui-btn-busy-text {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        /* room for the spinner and @busyLabel: show the busy label */
        .pretui-btn[data-busy-layout='text'] .pretui-btn-busy-text {
          position: static;
          width: auto;
          height: auto;
          overflow: visible;
          clip-path: none;
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
