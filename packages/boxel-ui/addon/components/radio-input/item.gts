import type { TemplateOnlyComponent } from '@ember/component/template-only';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { on } from '@ember/modifier';
import { not } from '@cardstack/boxel-ui/helpers/truth-helpers';

export interface Signature {
  Element: HTMLLabelElement;
  Args: {
    id: string;
    checked?: boolean;
    disabled?: boolean;
    name: string;
    hideBorder?: boolean;
    hideRadio?: boolean;
    onChange: () => void;
  };
  Blocks: {
    default: [];
  };
}

const RadioInputItem: TemplateOnlyComponent<Signature> = <template>
  <style>
    .boxel-radio-option {
      position: relative;
      display: block;
      max-width: 100%;
      padding: var(--boxel-radio-input-option-padding);
      border-radius: var(--boxel-border-radius);
      box-shadow: 0 0 0 1px var(--boxel-light-400);
      transition: box-shadow var(--boxel-transition);
    }

    .boxel-radio-option--hidden-border {
      box-shadow: 0 0 0 1px transparent;
    }

    .boxel-radio-option--has-radio {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      gap: var(--boxel-radio-input-option-gap);
    }

    .boxel-radio-option:hover:not(.boxel-radio-option--disabled) {
      box-shadow: 0 0 0 1px var(--boxel-dark);
      cursor: pointer;
    }

    .boxel-radio-option--checked:not(.boxel-radio-option--disabled),
    .boxel-radio-option:focus:not(.boxel-radio-option--disabled),
    .boxel-radio-option:focus-within:not(.boxel-radio-option--disabled) {
      box-shadow: 0 0 0 2px var(--boxel-highlight);
      outline: 1px solid transparent;
    }

    .boxel-radio-option--disabled > * {
      opacity: 0.5;
    }

    .boxel-radio-option__input {
      appearance: none;
      /* stylelint-disable-next-line property-no-vendor-prefix */
      -webkit-appearance: none;
      width: 1rem;
      height: 1rem;
      margin: 0;
      border: 1.5px solid var(--boxel-dark);
      border-radius: 100px;
      background-color: transparent;
    }

    .boxel-radio-option__input--checked {
      background-color: var(--boxel-highlight);
      border-width: 3px;
    }

    .boxel-radio-option__input:disabled {
      border-color: var(--boxel-purple-300);
    }

    .boxel-radio-option__input:focus:not(:disabled) {
      outline: 1px solid transparent;
    }

    /* https://css-tricks.com/customise-radio-buttons-without-compromising-accessibility/ */
    .boxel-radio-option__input--hidden-radio {
      position: absolute;
      top: 0;
      left: 0;
      clip-path: polygon(0 0);
      width: 1px;
      height: 1px;
    }

    /* default focus class - can be overwritten by providing @focusedClass */
    .boxel-radio-option__focused-item {
      outline: 1px solid var(--boxel-outline-color);
    }

    /* stylelint-disable-next-line no-descending-specificity */
    .boxel-radio-input--invalid .boxel-radio-option {
      box-shadow: 0 0 0 1px var(--boxel-error-100);
    }

    .boxel-radio-input--invalid .boxel-radio-option:focus {
      outline: 1px solid transparent; /* Make sure that we make the invalid state visible */
      box-shadow: 0 0 0 1.5px var(--boxel-error-100);
    }

    .boxel-radio-input--invalid .boxel-radio-option:hover:not(:disabled) {
      box-shadow: 0 0 0 1px var(--boxel-error-100);
    }
  </style>

  {{!
  anything that's used as a label does not have its semantics in a screenreader.
  that seems ok, since you probably shouldn't make a form work as document hierarchy.
  aria-labelledby seems friendlier to safari than the for element, but unsure about other browsers.
  }}
  <label
    class={{cn
      'boxel-radio-option'
      'boxel-radio-option--has-radio'
      boxel-radio-option--checked=@checked
      boxel-radio-option--disabled=@disabled
      boxel-radio-option--hidden-border=@hideBorder
      boxel-radio-option--has-radio=(not @hideRadio)
    }}
    data-test-boxel-radio-option
    data-test-boxel-radio-option-checked={{@checked}}
    data-test-boxel-radio-option-disabled={{@disabled}}
    data-test-boxel-radio-option-id={{@id}}
    ...attributes
  >
    <input
      class={{cn
        'boxel-radio-option__input'
        boxel-radio-option__input--hidden-radio=@hideRadio
        boxel-radio-option__input--checked=@checked
      }}
      type='radio'
      checked={{@checked}}
      disabled={{@disabled}}
      name={{@name}}
      {{on 'change' @onChange}}
    />
    <div>
      {{yield}}
    </div>
  </label>
</template>;

export default RadioInputItem;
