import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { assert } from '@ember/debug';
import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { ComponentLike } from '@glint/template';

import { cn, eq } from '../../helpers.gts';

export type SwitchSize = 'small' | 'base' | 'touch';
export const switchSizeOptions: SwitchSize[] = ['small', 'base', 'touch'];

interface SwitchSignature {
  Args: SwitchArgs;
  Blocks: {
    default?: [];
  };
  Element: HTMLLabelElement;
}
interface SwitchArgs {
  /* decorative glyph inside the thumb for the matching state; the label
     still names the control. Skipped at size small — the thumb is too
     small to carry a legible glyph there. */
  checkedIcon?: ComponentLike<{ Element: Element }>;
  disabled?: boolean;
  isEnabled: boolean;
  /* names the switch for assistive technology when no block is given; a
     yielded visible label names it instead, so pass one or the other.
     Glint can't tie block presence to the args type, so the requirement
     is asserted at render time rather than in the signature. */
  label?: string;
  onChange: (isEnabled: boolean) => void;
  size?: SwitchSize;
  uncheckedIcon?: ComponentLike<{ Element: Element }>;
}

/* Only reached when no visible label block is given, so an empty @label
   here means the switch would render with no accessible name at all.
   assert is compiled out of production builds. */
function srOnlyLabel(label: string | undefined) {
  assert(
    'Switch requires an accessible name: pass @label or provide a visible label block',
    Boolean(label && label.trim()),
  );
  return label;
}

/* explicit width/height attributes so icons carry intrinsic size (they
   scale with the thumb per preset, not with ambient CSS) */
function iconSize(size?: SwitchSize) {
  return size === 'touch' ? 14 : 10;
}

/* Fully controlled: preventDefault keeps the checkbox from toggling itself
   (click covers pointer and Space alike), so the DOM checked property — and
   the aria-checked the browser derives from it — only ever changes when
   @isEnabled does. Without this, an @onChange that drops the value would
   leave the native state disagreeing with the rendered one. */
function toggleOnClick(
  isEnabled: boolean,
  onChange: SwitchArgs['onChange'],
  event: Event,
) {
  event.preventDefault();
  onChange(!isEnabled);
}

/* Enter is inert on checkboxes, listed in WAI-ARIA as optional for role=switch,
   so it gets its own keydown path. https://www.w3.org/WAI/ARIA/apg/patterns/switch/
   Held keys repeat keydown, and unlike Space — which reaches the click handler
   only on keyup, once per press — nothing else throttles this path, so skip the
   repeats and toggle once per press. */
function toggleOnEnter(
  isEnabled: boolean,
  onChange: SwitchArgs['onChange'],
  event: Event,
) {
  if (event instanceof KeyboardEvent && event.key === 'Enter') {
    if (event.repeat) {
      return;
    }
    event.preventDefault();
    onChange(!isEnabled);
  }
}

const Switch: TemplateOnlyComponent<SwitchSignature> = <template>
  <label
    class={{cn
      'switch'
      (concat 'size-' (if @size @size 'base'))
      checked=@isEnabled
      disabled=@disabled
      has-label=(has-block)
    }}
    data-test-switch-checked={{if @isEnabled 'on' 'off'}}
    ...attributes
  >
    {{#if (has-block)}}
      <span class='switch-label'>{{yield}}</span>
    {{else}}
      <span class='boxel-sr-only'>{{srOnlyLabel @label}}</span>
    {{/if}}
    <span class='switch-track'>
      {{! a native checkbox's checkedness maps to aria-checked automatically;
          an explicit binding could disagree with it }}
      {{! template-lint-disable require-mandatory-role-attributes }}
      <input
        {{on 'click' (fn toggleOnClick @isEnabled @onChange)}}
        {{on 'keydown' (fn toggleOnEnter @isEnabled @onChange)}}
        class='switch-input'
        type='checkbox'
        checked={{@isEnabled}}
        disabled={{@disabled}}
        role='switch'
      />
      {{! presentational: the input above carries all semantics and state }}
      <span class='switch-thumb' aria-hidden='true'>
        {{#unless (eq @size 'small')}}
          {{#let (if @isEnabled @checkedIcon @uncheckedIcon) as |StateIcon|}}
            {{#if StateIcon}}
              <StateIcon width={{iconSize @size}} height={{iconSize @size}} />
            {{/if}}
          {{/let}}
        {{/unless}}
      </span>
    </span>
  </label>

  <style scoped>
    @layer boxelComponentL1 {
      .switch {
        --_switch-width: var(--boxel-switch-width, 2.125rem);
        --_switch-height: var(--boxel-switch-height, 1.25rem);
        --_switch-bg-color: var(--boxel-switch-background, var(--input));
        --_switch-active-color: var(
          --boxel-switch-active-background,
          var(--success, var(--primary))
        );
        --_switch-thumb-color: var(--boxel-switch-thumb, var(--background));
        --_switch-active-thumb-color: var(
          --boxel-switch-active-thumb,
          var(--_switch-thumb-color)
        );
        --_switch-thumb-edge-color: var(
          --boxel-switch-thumb-edge,
          color-mix(in oklch, var(--primary-foreground) 12%, transparent)
        );
        --_switch-thumb-icon-color: var(
          --boxel-switch-thumb-icon,
          var(--foreground)
        );
        --_switch-active-thumb-icon-color: var(
          --boxel-switch-active-thumb-icon,
          var(--_switch-thumb-icon-color)
        );
        --_switch-min-target: var(--boxel-switch-min-target, 1.5rem);

        display: inline-flex;
        align-items: center;
        color: var(--boxel-switch-foreground, var(--foreground));
        /* Pads the label out to the 24px minimum target size (WCAG 2.5.8)
           when the drawn track is smaller, without growing the track. The
           padding is inside the element's own box, so the target never
           overlaps a neighboring control the way an outset overlay would;
           max() keeps it at zero once the track already clears the minimum.
           align-items: center keeps the track centered in the padded box. */
        padding-block: max(
          0px,
          calc((var(--_switch-min-target) - var(--_switch-height)) / 2)
        );
        padding-inline: max(
          0px,
          calc((var(--_switch-min-target) - var(--_switch-width)) / 2)
        );
      }

      .switch.has-label {
        gap: var(--boxel-sp-xs);
      }

      /* Size presets set the same public knobs callers use, so all geometry
         (thumb, travel, hit area) follows; an inline --boxel-switch-* on the
         element still outranks them. size-base has no rule: it keeps the
         defaults and lets ancestor-provided variables through. */
      .switch.size-small {
        --boxel-switch-width: 1.75rem;
        --boxel-switch-height: 1rem;
      }

      /* meets the 24px target size (WCAG 2.5.8) on its drawn size alone */
      .switch.size-touch {
        --boxel-switch-width: 2.75rem;
        --boxel-switch-height: 1.625rem;
      }

      /* With no visible label the wrapper has no other content, so it sizes
         to this track plus whatever padding the minimum target size adds. */
      .switch-track {
        box-sizing: border-box;
        flex: none;
        position: relative;
        width: var(--_switch-width);
        height: var(--_switch-height);
        border-radius: var(--boxel-border-radius-pill);
        padding: 1px;
        display: inline-flex;
        align-items: center;
        background-color: var(--_switch-bg-color);
        border: 1px solid var(--border);
        box-shadow: var(--shadow-xs);
      }

      /* Invisible semantic layer over the track: still the focusable,
         checkable element and the :focus-visible source for the track's
         ring; the sibling .switch-thumb draws what used to be here. */
      .switch-input {
        -webkit-appearance: none;
        appearance: none;
        position: absolute;
        inset: 0;
        margin: 0;
        opacity: 0;
        /* the UA gives disabled inputs their own cursor, which would
           disagree with the control's */
        cursor: inherit;
      }

      .switch-thumb {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        aspect-ratio: 1;
        background-color: var(--_switch-thumb-color);
        /* icons draw with currentColor */
        color: var(--_switch-thumb-icon-color);
        border-radius: 50%;
        /* a shadow ring, not a border: a border would add to the thumb's
           border-box and break the height:100% + aspect-ratio square. The
           foreground-derived color keeps the thumb visible in themes where
           --input and --background nearly coincide. */
        box-shadow: 0 0 0 1px var(--_switch-thumb-edge-color);
      }

      /* Thumb travel is width minus height: border and padding subtract
         equally from the track's content box and the (square, track-height)
         thumb, so the difference holds at any size or border/padding and the
         thumb always lands flush against the far edge. */
      .switch.checked .switch-thumb {
        background-color: var(--_switch-active-thumb-color);
        color: var(--_switch-active-thumb-icon-color);
        transform: translateX(
          calc(var(--_switch-width) - var(--_switch-height))
        );
      }

      .switch.checked:dir(rtl) .switch-thumb {
        transform: translateX(
          calc(-1 * (var(--_switch-width) - var(--_switch-height)))
        );
      }

      .switch.checked .switch-track {
        background-color: var(--_switch-active-color);
      }

      .switch:has(:focus-visible) .switch-track {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }

      /* pressed-state affordance: the thumb swells slightly under the
         pointer. `scale` composes with the checked-state translate, so it
         works in both positions. */
      .switch:not(.disabled):active .switch-thumb {
        scale: 1.05;
      }

      @media (prefers-reduced-motion: no-preference) {
        .switch-track {
          transition: background-color 0.1s ease-in;
        }

        .switch-thumb {
          transition:
            transform 0.1s ease-in,
            scale 0.1s ease-in;
        }
      }

      .switch:hover {
        cursor: pointer;
      }

      .switch.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  </style>
</template>;

export default Switch;
