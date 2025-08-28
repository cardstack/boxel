import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';

import { cn, not } from '../../helpers.ts';
import cssVar from '../../helpers/css-var.ts';

export interface Signature {
  Args: {
    checked?: boolean;
    disabled?: boolean;
    hideBorder?: boolean;
    hideRadio?: boolean;
    id: string;
    name: string;
    onChange: () => void;
    radioBackgroundColor?: string;
    radioBorderColor?: string;
    radioHighlightColor?: string;
    variant?: 'primary' | 'secondary' | 'muted' | 'destructive' | 'default';
  };
  Blocks: {
    default: [];
  };
  Element: HTMLLabelElement;
}

const RadioInputItem: TemplateOnlyComponent<Signature> = <template>
  <style scoped>
    @layer {
      .boxel-radio-option {
        --radio-border: 1.5px solid
          var(
            --boxel-radio-border-color,
            var(--radio-foreground, var(--foreground, var(--boxel-dark))),
          );
        --radio-border-radius: var(--boxel-border-radius, 100px);
        --radio-background: var(
          --boxel-radio-background-color,
          var(--radio-background-color, var(--background, var(--boxel-light)))
        );
        --radio-foreground: var(
          --boxel-radio-foreground-color,
          var(--radio-foreground-color, var(--foreground, var(--boxel-dark)))
        );
        --radio-checked-background: var(
          --boxel-radio-checked-background-color,
          var(
            --radio-checked-background-color,
            var(--background, var(--boxel-highlight))
          )
        );
        --radio-highlight: var(
          --boxel-radio-highlight-color,
          var(
            --radio-highlight-color,
            var(--foreground, var(--boxel-highlight))
          )
        );
        --radio-disabled-border-color: var(
          --boxel-radio-disabled-border-color,
          var(
            --radio-disabled-border-color,
            var(--muted-foreground, var(--boxel-purple-300))
          )
        );

        position: relative;
        display: block;
        max-width: 100%;
        background-color: var(--radio-background);
        color: var(--radio-foreground);
        padding: var(--boxel-radio-input-option-padding);
        border-radius: var(--radio-border-radius);
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
        box-shadow: 0 0 0 var(--boxel-outline-width) var(--radio-highlight);
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
        border: var(--radio-border);
        border-radius: var(--radio-border-radius);
      }

      .boxel-radio-option__input--checked {
        background-color: var(--radio-checked-background);
        border-width: 3px;
      }

      .boxel-radio-option__input:disabled {
        border-color: var(--radio-disabled-border-color);
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

      .variant-primary {
        --radio-background-color: var(--primary, var(--boxel-highlight));
        --radio-foreground-color: var(--primary-foreground, var(--boxel-dark));
        --radio-checked-background: var(--primary, var(--boxel-highlight));
        --radio-highlight-color: var(--boxel-dark);
      }

      .variant-secondary {
        --radio-background-color: var(--secondary, var(--boxel-400));
        --radio-foreground-color: var(
          --secondary-foreground,
          var(--boxel-dark)
        );
        --radio-checked-background: var(--secondary, var(--boxel-400));
        --radio-highlight-color: var(--boxel-dark);
      }

      .variant-muted {
        --radio-background-color: var(--muted, var(--boxel-200));
        --radio-foreground-color: var(--muted-foreground, var(--boxel-dark));
        --radio-checked-background: var(--muted, var(--boxel-200));
        --radio-highlight-color: var(--boxel-300);
      }

      .variant-destructive {
        --radio-background-color: var(--destructive, var(--boxel-danger));
        --radio-foreground-color: var(
          --destructive-foreground,
          var(--boxel-dark)
        );
        --radio-checked-background: var(--destructive, var(--boxel-danger));
        --radio-highlight-color: var(--boxel-dark);
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
      (if @checked 'boxel-radio-option--checked')
      (if @disabled 'boxel-radio-option--disabled')
      (if @hideBorder 'boxel-radio-option--hidden-border')
      (if (not @hideRadio) 'boxel-radio-option--has-radio')
      (if @variant (concat 'variant-' @variant) 'variant-default')
    }}
    style={{cssVar
      boxel-radio-background-color=@radioBackgroundColor
      boxel-radio-border-color=@radioBorderColor
      boxel-radio-highlight-color=@radioHighlightColor
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
