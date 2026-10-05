// Pretui — Toggle: one button whose meaning is state.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { Button } from './button';
import { PRETUI_TONES, emit, firstDefined, resolveSize, resolveTone } from '../pretui-primitives';
import type {
  PretuiAppearance,
  PretuiSize,
  PretuiSizeArg,
  PretuiToneArg,
  PretuiTone,
} from '../pretui-primitives';

// ═════════════════════════════════════════════════════════════════════════
// Toggle
// ═════════════════════════════════════════════════════════════════════════

/** Which ARIA attribute carries the pressed state.
 *
 * `pressed` is a standalone toggle button and a multi-select toolbar member.
 * `checked` is what a single-select group needs, where the member also wears
 * `role='radio'` — the same swap Radix's ToggleGroup performs by deleting
 * `aria-pressed` from the item's props. `none` hands the state to a parent
 * that owns the ARIA itself. */
export type ToggleAriaState = 'pressed' | 'checked' | 'none';

export interface ToggleSignature {
  Args: {
    /** CONTROLLED pressed state. Omit to let the component own it. */
    pressed?: boolean;
    /** uncontrolled seed; ignored once `@pressed` is supplied */
    defaultPressed?: boolean;
    /** fires with the NEXT state on every activation */
    onPressedChange?: (pressed: boolean) => void;
    /** which ARIA attribute carries the state. `pressed` (default) is a
     * standalone toggle or a toolbar member; `checked` is what a single-select
     * `ToggleGroup` member needs beside its `role='radio'`; `none` hands the
     * state to a parent that writes the ARIA itself. */
    ariaState?: ToggleAriaState;
    /** alias — the Radix/shadcn spelling is already the house name here, so
     * this is the HTML-shaped notify for an agent that reaches for it */
    onChange?: (pressed: boolean) => void;
    /** accessible name. Required in `@iconOnly` mode, where there is no text
     * for a reader to fall back on. */
    label?: string;
    /** draw the glyph only; `@label` becomes the sr-only name and the title */
    iconOnly?: boolean;
    /** Hue, default `neutral`. Accepts `destructive`/`brand`/… */
    tone?: PretuiToneArg;
    /** recipe worn at rest, default `outlined` */
    appearance?: PretuiAppearance;
    /** recipe worn while pressed, default `accent`. The pressed state is an
     * APPEARANCE SWAP rather than a tint, so it survives greyscale (Law 6). */
    pressedAppearance?: PretuiAppearance;
    /** Scale, default `m`. Accepts `sm`/`md`/`lg`/`default`. */
    size?: PretuiSizeArg;
    /** dims and inerts, but stays focusable and announced (`aria-disabled`) */
    disabled?: boolean;
    /** alias — React Aria / Base UI spelling of `@disabled` */
    isDisabled?: boolean;
    /** pending: `aria-busy`, a spinner, clicks ignored, FOCUS RETAINED */
    busy?: boolean;
    /** aliases — the spellings the React corpus emits for `@busy` */
    loading?: boolean;
    isPending?: boolean;
  };
  Blocks: {
    /** yields the resolved state, so a caller can swap the glyph in place
     * rather than render two of them and hide one */
    default: [{ pressed: boolean }];
  };
  Element: HTMLButtonElement;
}

/**
 * A single button whose meaning is a state rather than an action.
 *
 * **From:** Radix `Toggle` (`packages/react/toggle/src/toggle.tsx`), whose
 * whole body is `aria-pressed`, `data-state`, and a controllable boolean.
 *
 * **Better than the inspiration.** Radix's Toggle passes `disabled` straight
 * to the button element, which removes it from the tab order — fine for one
 * button on a page, wrong the moment a toolbar with roving tabindex holds it,
 * because the group changes shape between visits and can never be learned.
 * This one is always `aria-disabled`, which is the kit's law and the reason
 * `ToggleGroup` could adopt it unchanged. Radix also has no visual opinion at
 * all, so every consumer re-derives "what does pressed look like" and almost
 * every one of them reaches for a tint — colour-only signalling. Here pressed
 * is an appearance recipe swap over the tone channel, so it reads
 * in greyscale AND re-tints with a season it has never seen. Radix has no
 * pending state; `@busy` here is React Aria's *pending* semantics (`aria-busy`
 * + retained focus) rather than a disable. And Radix's `data-state` is the
 * only thing it exposes to CSS; this reflects the whole resolved treatment as
 * `data-tone` / `data-appearance` / `data-size` / `data-state` so a consumer
 * styles states in CSS instead of through args.
 */
export class Toggle extends Component<ToggleSignature> {
  @tracked private internal: boolean = this.args.defaultPressed ?? false;

  get pressed(): boolean {
    return this.args.pressed ?? this.internal;
  }
  get inert(): boolean {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get busy(): boolean {
    return (
      firstDefined(this.args.busy, this.args.loading, this.args.isPending) ??
      false
    );
  }
  get tone(): PretuiTone {
    return resolveTone(this.args.tone, PRETUI_TONES, 'neutral');
  }
  get size(): PretuiSize {
    return resolveSize(this.args.size);
  }
  /** The recipe actually worn right now — the whole visual contract of the
   * component is this one line. */
  get appearance(): PretuiAppearance {
    return this.pressed
      ? (this.args.pressedAppearance ?? 'accent')
      : (this.args.appearance ?? 'outlined');
  }
  get ariaState(): ToggleAriaState {
    return this.args.ariaState ?? 'pressed';
  }
  get pressedAttr(): string | undefined {
    return this.ariaState === 'pressed' ? String(this.pressed) : undefined;
  }
  get checkedAttr(): string | undefined {
    return this.ariaState === 'checked' ? String(this.pressed) : undefined;
  }
  /** Busy wins the state slot so `Button`'s own busy rules still apply; the
   * pressed state is still legible because it lives in the appearance. */
  get stateAttr(): string {
    if (this.busy) {
      return 'busy';
    }
    return this.pressed ? 'on' : 'off';
  }

  activate = () => {
    if (this.inert || this.busy) {
      return;
    }
    let next = !this.pressed;
    if (this.args.pressed === undefined) {
      this.internal = next;
    }
    emit([this.args.onPressedChange, this.args.onChange], next);
  };

  <template>
    <Button
      class='pretui-toggle'
      @tone={{this.tone}}
      @appearance={{this.appearance}}
      @size={{this.size}}
      aria-pressed={{this.pressedAttr}}
      aria-checked={{this.checkedAttr}}
      aria-disabled={{if this.inert 'true'}}
      aria-busy={{if this.busy 'true'}}
      aria-label={{if @iconOnly @label}}
      title={{if @iconOnly @label}}
      data-state={{this.stateAttr}}
      data-pressed={{if this.pressed 'true' 'false'}}
      data-test-pretui-toggle
      ...attributes
      {{on 'click' this.activate}}
    >
      {{#if this.busy}}
        <span class='pretui-toggle-spin' aria-hidden='true'></span>
      {{/if}}
      <span class='pretui-toggle-face'>
        {{yield (hash pressed=this.pressed)}}
      </span>
    </Button>
    <style scoped>
      /* above Button's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        /* Everything visual arrives through Button's own token channel and its
           appearance recipes, so this file paints nothing a season cannot
           retune. What is left is the press feedback and the pending ring. */
        .pretui-toggle {
          flex: none;
        }
        .pretui-toggle:active:not([aria-disabled='true']) {
          transform: scale(0.96);
        }
        .pretui-toggle[aria-disabled='true'] {
          opacity: 0.45;
          cursor: default;
        }
        .pretui-toggle[aria-busy='true'] {
          cursor: progress;
        }
        .pretui-toggle-face {
          display: inline-flex;
          align-items: center;
          gap: 0.4em;
          min-width: 0;
        }
        @keyframes pretui-toggle-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .pretui-toggle-spin {
          flex: none;
          width: 1.04em;
          height: 1.04em;
          border-radius: 50%;
          border: 1.5px solid color-mix(in oklch, currentColor 25%, transparent);
          border-top-color: currentColor;
          animation: pretui-toggle-spin 0.7s linear infinite;
        }
        /* The end state has to still READ as pending, so the ring stops at an
           angle that is obviously not a closed circle rather than at rest. */
        @media (prefers-reduced-motion: reduce) {
          .pretui-toggle-spin {
            animation: none;
            transform: rotate(135deg);
          }
          .pretui-toggle:active:not([aria-disabled='true']) {
            transform: none;
          }
        }
      }
    </style>
  </template>
}
