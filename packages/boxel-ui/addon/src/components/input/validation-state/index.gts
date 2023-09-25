import { svgJar } from '../../../helpers/svg-jar.ts';
import Component from '@glimmer/component';

import BoxelInput from '../index.gts';

export type InputValidationState = 'valid' | 'invalid' | 'loading' | 'initial';

interface ValidationStateInputArgs {
  disabled?: boolean;
  errorMessage?: string;
  helperText?: string;
  id?: string;
  // from https://developer.mozilla.org/en-US/docs/Web/HTML/Element/Input (add more as needed)
  type?:
    | 'password'
    | 'number'
    | 'email'
    | 'color'
    | 'tel'
    | 'file'
    | 'url'
    | 'date'
    | 'datetime-local'
    | 'checkbox'
    | 'image'
    | 'radio'
    | 'range'
    | 'search';
  onBlur?: (ev: Event) => void;
  onFocus?: (ev: Event) => void;
  onInput?: (val: string) => void;
  onKeyPress?: (ev: KeyboardEvent) => void;
  placeholder?: string;
  state: InputValidationState;
  value: string;
}

interface Signature {
  Args: ValidationStateInputArgs;
  Element: HTMLDivElement;
}

export default class BoxelInputValidationState extends Component<Signature> {
  get icon(): string {
    if (this.args.disabled) {
      return '';
    }
    switch (this.args.state) {
      case 'valid':
        return 'success-bordered';
      case 'invalid':
        return 'failure-bordered';
      case 'loading':
        return 'loading-indicator';
      case 'initial':
        return '';
      default:
        return '';
    }
  }

  get isInvalid(): boolean {
    return this.args.state === 'invalid';
  }

  <template>
    <div class='input-group' ...attributes>
      <BoxelInput
        class='input'
        @id={{@id}}
        @value={{@value}}
        @required={{unless @disabled true}}
        @onInput={{@onInput}}
        @onBlur={{@onBlur}}
        @invalid={{unless @disabled this.isInvalid}}
        @disabled={{@disabled}}
        @errorMessage={{@errorMessage}}
        @helperText={{@helperText}}
        @placeholder={{@placeholder}}
        @onKeyPress={{@onKeyPress}}
        @onFocus={{@onFocus}}
        {{! BoxelInput gets this from '...attribues' }}
        type={{@type}}
        autocomplete='off'
        autocorrect='off'
        autocapitalize='off'
        spellcheck='false'
        data-test-boxel-input-validation-state={{if @disabled true @state}}
      />
      {{#if this.icon}}
        <span class='boxel-validation-state-input-group__icon'>
          {{svgJar this.icon role='presentation'}}
        </span>
      {{/if}}
    </div>

    <style>
      @layer {
        .input-group {
          --validation-group-height: 4.375rem;
          --validation-group-icon-size: var(--boxel-icon-sm);
          --validation-group-icon-space: var(--boxel-sp-xs);

          position: relative;
          width: 100%;
          height: var(--validation-group-height);
        }

        .input {
          padding-right: calc(
            var(--validation-group-icon-size) +
              var(--validation-group-icon-space) * 2
          );
        }

        .boxel-validation-state-input-group__icon {
          position: absolute;
          width: var(--validation-group-icon-size);
          right: var(--validation-group-icon-space);
          top: var(--validation-group-icon-space);
          display: inline-block;
          user-select: none;
        }
      }
    </style>
  </template>
}
