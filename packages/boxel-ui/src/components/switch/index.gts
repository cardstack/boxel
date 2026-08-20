import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { cn } from '../../helpers.gts';

interface SwitchSignature {
  Args: SwitchArgs;
  Element: HTMLLabelElement;
}
interface SwitchArgs {
  disabled?: boolean;
  isEnabled: boolean;
  label: string;
  onChange: (isEnabled: boolean) => void;
}

function announceChange(onChange: SwitchArgs['onChange'], event: Event) {
  onChange((event.target as HTMLInputElement).checked);
}

/* Enter is inert on checkboxes, listed in WAI-ARIA as optional for role=switch,
   so it gets its own keydown path. https://www.w3.org/WAI/ARIA/apg/patterns/switch/ */
function toggleOnEnter(onChange: SwitchArgs['onChange'], event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault();
    onChange(!(event.target as HTMLInputElement).checked);
  }
}

const Switch: TemplateOnlyComponent<SwitchSignature> = <template>
  <label
    class={{cn 'switch' checked=@isEnabled disabled=@disabled}}
    data-test-switch-checked={{if @isEnabled 'on' 'off'}}
    ...attributes
  >
    <span class='boxel-sr-only'>{{@label}}</span>
    <input
      {{on 'change' (fn announceChange @onChange)}}
      {{on 'keydown' (fn toggleOnEnter @onChange)}}
      class='switch-input'
      type='checkbox'
      checked={{@isEnabled}}
      disabled={{@disabled}}
      aria-checked={{if @isEnabled 'true' 'false'}}
      role='switch'
    />
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
          color-mix(in oklch, var(--foreground) 25%, transparent)
        );

        box-sizing: border-box;
        width: var(--_switch-width);
        height: var(--_switch-height);
        border-radius: var(--boxel-border-radius-pill);
        padding: 1px;
        display: inline-flex;
        align-items: center;
        transition: background-color 0.1s ease-in;
        position: relative;
        background-color: var(--_switch-bg-color);
        color: var(--boxel-switch-foreground, var(--foreground));
        border: 1px solid var(--border);
        box-shadow: var(--shadow-xs);
      }

      .switch-input {
        -webkit-appearance: none;
        appearance: none;
        margin: 0;
        height: 100%;
        aspect-ratio: 1;
        background-color: var(--_switch-thumb-color);
        border-radius: 50%;
        /* a shadow ring, not a border: a border would add to the thumb's
           border-box and break the height:100% + aspect-ratio square. The
           foreground-derived color keeps the thumb visible in themes where
           --input and --background nearly coincide. */
        box-shadow: 0 0 0 1px var(--_switch-thumb-edge-color);
        transition: transform 0.1s ease-in;
        /* the control's ring is drawn on the label below; the UA ring here
           would halo the thumb instead */
        outline: none;
      }

      /* Thumb travel is width minus height: border and padding subtract
         equally from the track's content box and the (square, track-height)
         thumb, so the difference holds at any size or border/padding and the
         thumb always lands flush right. */
      .switch.checked .switch-input {
        background-color: var(--_switch-active-thumb-color);
        transform: translateX(
          calc(var(--_switch-width) - var(--_switch-height))
        );
      }

      .switch.checked {
        background-color: var(--_switch-active-color);
      }

      .switch:has(:focus-visible) {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }

      .switch:hover {
        cursor: pointer;
      }

      .switch.disabled {
        opacity: 0.5;
        cursor: default;
      }
    }
  </style>
</template>;

export default Switch;
