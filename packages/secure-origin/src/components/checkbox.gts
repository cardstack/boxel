// boxel-ui's checkbox: its BoxelInput drawn with `@type='checkbox'`, a square
// box filled with the theme's primary colour and a check mark when ticked.
// boxel-ui can't ship on the secure origin (ADR 008 §1.3), so its template
// and styles are brought here, kept as they are there, for the checkbox
// alone. Attributes go on the input, so a label wrapping it names it.
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import CheckMark from './icons/check-mark.gts';

interface Signature {
  Args: {
    checked: boolean;
    onChange: (event: Event) => void;
    disabled?: boolean;
  };
  Element: HTMLInputElement;
}

const Checkbox: TemplateOnlyComponent<Signature> = <template>
  <span class='input-container is-checkbox'>
    <input
      class='boxel-input'
      type='checkbox'
      checked={{@checked}}
      disabled={{@disabled}}
      {{on 'change' @onChange}}
      ...attributes
    />
    {{#if @checked}}
      <CheckMark class='checkbox-checkmark-icon' aria-hidden='true' />
    {{/if}}
  </span>

  <style scoped>
    .input-container.is-checkbox {
      --checkbox-size: var(--boxel-checkbox-size, var(--boxel-body-font-size));
      --checkbox-border-radius: var(--boxel-checkbox-border-radius, 0.1875rem);
      --checkbox-border-color: var(
        --boxel-checkbox-border-color,
        var(--border)
      );
      --checkbox-background: var(
        --boxel-checkbox-background-color,
        var(--background)
      );
      --checkbox-checked-background: var(
        --boxel-checkbox-checked-background-color,
        var(--primary)
      );
      --checkbox-checked-border-color: var(
        --boxel-checkbox-checked-border-color,
        var(--primary)
      );
      --checkbox-checkmark-color: var(
        --boxel-checkbox-checkmark-color,
        var(--primary-foreground)
      );

      display: inline-grid;
      grid-template-columns: auto;
      grid-template-areas: 'input';
      width: auto;
      align-items: center;
      justify-items: center;
      position: relative;
      flex-shrink: 0;
    }

    .checkbox-checkmark-icon {
      grid-area: input;
      pointer-events: none;
      width: calc(var(--checkbox-size) * 0.8);
      height: calc(var(--checkbox-size) * 0.8);
      --icon-color: var(--checkbox-checkmark-color);
    }

    .boxel-input[type='checkbox'] {
      grid-area: input;
      appearance: none;
      /* stylelint-disable-next-line property-no-vendor-prefix */
      -webkit-appearance: none;
      box-sizing: border-box;
      width: var(--checkbox-size);
      height: var(--checkbox-size);
      min-height: unset;
      padding: 0;
      margin: 0;
      border: 1px solid var(--checkbox-border-color);
      border-radius: var(--checkbox-border-radius);
      background-color: var(--checkbox-background);
      box-shadow: none;
      cursor: pointer;
      transition:
        background-color var(--boxel-transition),
        border-color var(--boxel-transition);
      flex-shrink: 0;
    }

    .boxel-input[type='checkbox']:checked {
      background-color: var(--checkbox-checked-background);
      border-color: var(--checkbox-checked-border-color);
    }

    .boxel-input[type='checkbox']:focus-visible {
      outline: 2px solid var(--ring);
      outline-offset: 2px;
      border-color: var(--checkbox-border-color);
    }

    .boxel-input[type='checkbox']:hover:not(:disabled):not(:checked) {
      border-color: currentColor;
    }

    .boxel-input[type='checkbox']:hover:not(:disabled):checked {
      border-color: var(--checkbox-checked-border-color);
    }

    .boxel-input[type='checkbox']:disabled {
      opacity: 0.5;
      cursor: default;
    }
  </style>
</template>;

export default Checkbox;
