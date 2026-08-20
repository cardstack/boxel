import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { cn } from '../../helpers.gts';

interface SwitchSignature {
  Args: SwitchArgs;
  Blocks: {
    default?: [];
  };
  Element: HTMLLabelElement;
}
interface SwitchArgs {
  disabled?: boolean;
  isEnabled: boolean;
  /* names the switch for assistive technology when no block is given; a
     yielded visible label names it instead, so pass one or the other */
  label?: string;
  onChange: (isEnabled: boolean) => void;
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
   so it gets its own keydown path. https://www.w3.org/WAI/ARIA/apg/patterns/switch/ */
function toggleOnEnter(
  isEnabled: boolean,
  onChange: SwitchArgs['onChange'],
  event: Event,
) {
  if (event instanceof KeyboardEvent && event.key === 'Enter') {
    event.preventDefault();
    onChange(!isEnabled);
  }
}

const Switch: TemplateOnlyComponent<SwitchSignature> = <template>
  <label
    class={{cn
      'switch'
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
      <span class='boxel-sr-only'>{{@label}}</span>
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

        display: inline-flex;
        align-items: center;
        position: relative;
        color: var(--boxel-switch-foreground, var(--foreground));
      }

      .switch.has-label {
        gap: var(--boxel-sp-xs);
      }

      /* With no visible label the wrapper has no other content, so it sizes
         exactly to this track and consumer CSS on the label element keeps
         behaving as if the label were the track itself. */
      .switch-track {
        box-sizing: border-box;
        flex: none;
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

      .switch-input {
        -webkit-appearance: none;
        appearance: none;
        margin: 0;
        /* the UA gives disabled inputs their own cursor, which would make
           the thumb disagree with the track */
        cursor: inherit;
        height: 100%;
        aspect-ratio: 1;
        background-color: var(--_switch-thumb-color);
        border-radius: 50%;
        /* a shadow ring, not a border: a border would add to the thumb's
           border-box and break the height:100% + aspect-ratio square. The
           foreground-derived color keeps the thumb visible in themes where
           --input and --background nearly coincide. */
        box-shadow: 0 0 0 1px var(--_switch-thumb-edge-color);
        /* the control's ring is drawn on the track below; the UA ring here
           would halo the thumb instead */
        outline: none;
      }

      /* Extends the clickable surface past the drawn control so it meets the
         24px minimum target size (WCAG 2.5.8) without growing visually. Part
         of the label, so clicks here toggle as usual. */
      .switch::before {
        content: '';
        position: absolute;
        inset: calc(-1 * var(--boxel-switch-hit-inset, 0.5rem));
      }

      /* Thumb travel is width minus height: border and padding subtract
         equally from the track's content box and the (square, track-height)
         thumb, so the difference holds at any size or border/padding and the
         thumb always lands flush against the far edge. */
      .switch.checked .switch-input {
        background-color: var(--_switch-active-thumb-color);
        transform: translateX(
          calc(var(--_switch-width) - var(--_switch-height))
        );
      }

      .switch.checked:dir(rtl) .switch-input {
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
      .switch:not(.disabled):active .switch-input {
        scale: 1.15;
      }

      @media (prefers-reduced-motion: no-preference) {
        .switch-track {
          transition: background-color 0.1s ease-in;
        }

        .switch-input {
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
