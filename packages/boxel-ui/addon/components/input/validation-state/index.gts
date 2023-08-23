import Component from '@glimmer/component';
import BoxelInput from '../index';
import { type EmptyObject } from '@ember/component/helper';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';

export type InputValidationState = 'valid' | 'invalid' | 'loading' | 'initial';

interface ValidationStateInputArgs {
  state: InputValidationState;
  disabled?: boolean;
  errorMessage?: string;
  helperText?: string;
  placeholder?: string;
  id?: string;
  value: string;
  onInput?: (val: string) => void;
  onBlur?: (ev: Event) => void;
  onKeyPress?: (ev: KeyboardEvent) => void;
  onFocus?: (ev: Event) => void;
}

interface Signature {
  Element: HTMLDivElement;
  Args: ValidationStateInputArgs;
  Blocks: EmptyObject;
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
        autocomplete='off'
        autocorrect='off'
        autocapitalize='off'
        spellcheck='false'
        data-test-boxel-input-validation-state={{if @disabled true @state}}
      />
      {{#if this.icon}}
        {{svgJar
          this.icon
          class='boxel-validation-state-input-group__icon'
          role='presentation'
        }}
      {{/if}}
    </div>

    <style>
      .input-group {
        --input-height: 2.5rem;
        --input-icon-size: var(--boxel-icon-sm);
        --input-icon-space: var(--boxel-sp-xs);
        --input-font-size: inherit;

        position: relative;
        width: 100%;
        font-family: var(--boxel-font-family);
        font-size: var(--input-font-size);
        line-height: calc(27 / 20);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .input {
        height: var(--input-height);
        padding-right: calc(
          var(--input-icon-size) + var(--input-icon-space) * 2
        );
        font: inherit;
        letter-spacing: inherit;
      }

      :global(.boxel-validation-state-input-group__icon) {
        position: absolute;
        width: var(--input-icon-size);
        height: var(--input-height);
        right: var(--input-icon-space);
        top: 0;
        user-select: none;
      }
    </style>
  </template>
}
