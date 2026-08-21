import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { warn } from '@ember/debug';
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
  /* decorative; skipped at size small, where no glyph stays legible */
  checkedIcon?: ComponentLike<{ Element: Element }>;
  disabled?: boolean;
  isEnabled: boolean;
  label?: string; /* Visually-hidden accessible name. Use default block instead to add a visible label. */
  onChange: (isEnabled: boolean) => void;
  size?: SwitchSize;
  uncheckedIcon?: ComponentLike<{ Element: Element }>;
}

function srOnlyLabel(label: string | undefined) {
  warn(
    'Switch has no accessible name: pass @label or a visible label block',
    Boolean(label && label.trim()),
    { id: 'boxel-ui.switch.missing-label' },
  );
  return label;
}

/* Warns rather than asserts so a mislabeled switch still renders */
function warnOnRedundantLabel(label: string | undefined) {
  warn(
    'Switch ignores @label when a visible label block is given — the block names the control',
    label === undefined,
    { id: 'boxel-ui.switch.redundant-label' },
  );
  return '';
}

/* Intrinsic size, which prerendering needs. Tracks the @size presets
   only; .switch-thumb clamps glyphs when CSS sets the geometry. */
function iconSize(size?: SwitchSize) {
  return size === 'touch' ? 14 : 10;
}

/* Fully controlled: preventDefault stops the checkbox toggling itself, so
   checked — and the aria-checked derived from it — follows @isEnabled
   alone, even when @onChange drops the value. Click covers Space too. */
function toggleOnClick(
  isEnabled: boolean,
  onChange: SwitchArgs['onChange'],
  event: Event,
) {
  event.preventDefault();
  onChange(!isEnabled);
}

/* Checkboxes ignore Enter, which WAI-ARIA lists as optional for
   role=switch, so it needs its own keydown path — and its own repeat
   guard, since Space activates on keyup and cannot repeat.
   https://www.w3.org/WAI/ARIA/apg/patterns/switch/ */
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
      <span class='switch-label'>{{warnOnRedundantLabel @label}}{{yield}}</span>
    {{else}}
      <span class='boxel-sr-only'>{{srOnlyLabel @label}}</span>
    {{/if}}
    <span class='switch-track'>
      {{! aria-checked is derived from checked; binding it could disagree }}
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
      {{! presentational: the input carries the semantics and state }}
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
          color-mix(in oklch, var(--foreground) 12%, transparent)
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
        /* Reaches the 24px minimum target (WCAG 2.5.8) inside the
           element's own box, so it never covers a neighbor. */
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

      /* Presets set the public knobs, so all geometry follows; an inline
         --boxel-switch-* still outranks them. */
      .switch.size-small {
        --boxel-switch-width: 1.75rem;
        --boxel-switch-height: 1rem;
      }

      /* meets the 24px target size (WCAG 2.5.8) on its drawn size alone */
      .switch.size-touch {
        --boxel-switch-width: 2.75rem;
        --boxel-switch-height: 1.625rem;
      }

      .switch-track {
        box-sizing: border-box;
        flex: none;
        position: relative;
        width: var(--_switch-width);
        height: var(--_switch-height);
        /* the one radius token CardContainer does not re-declare */
        border-radius: var(--boxel-border-radius-pill, 9999px);
        padding: 1px;
        display: inline-flex;
        align-items: center;
        background-color: var(--_switch-bg-color);
        border: 1px solid var(--border);
        box-shadow: var(--shadow-xs);
      }

      /* Invisible, but still the focusable, checkable element and the
         :focus-visible source for the track's ring. */
      .switch-input {
        -webkit-appearance: none;
        appearance: none;
        position: absolute;
        inset: 0;
        margin: 0;
        opacity: 0;
        /* the UA's disabled cursor would disagree with the control's */
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
        /* A shadow, not a border, which would grow the border-box and
           break the aspect-ratio square. --foreground because it inverts:
           this exists for themes where --input and --background meet. */
        box-shadow: 0 0 0 1px var(--_switch-thumb-edge-color);
      }

      /* The icon's intrinsic size follows @size only, so CSS-set geometry
         could overflow the thumb. :deep: the svg is the caller's. */
      .switch-thumb :deep(svg) {
        max-width: 60%;
        max-height: 60%;
      }

      /* Travel is width minus height: border and padding subtract equally
         from the track's content box and the square thumb, so the thumb
         lands flush against the far edge at any size. */
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

      /* scale composes with the checked translate, so the pressed thumb
         swells in both positions */
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
