import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';

import cn from '../../helpers/cn.ts';
import element from '../../helpers/element.ts';
import optional from '../../helpers/optional.ts';
import pick from '../../helpers/pick.ts';
import { and, eq, not } from '../../helpers/truth-helpers.ts';
import FailureBordered from '../../icons/failure-bordered.gts';
import IconSearch from '../../icons/icon-search.gts';
import LoadingIndicator from '../../icons/loading-indicator.gts';
import SuccessBordered from '../../icons/success-bordered.gts';
import type { Icon } from '../../icons/types.ts';

type Values<T> = T[keyof T];

export const InputTypes = {
  Text: 'text',
  Textarea: 'textarea',
  Password: 'password',
  Number: 'number',
  Email: 'email',
  Color: 'color',
  Tel: 'tel',
  File: 'file',
  Url: 'url',
  Date: 'date',
  Datetime: 'datetime-local',
  Checkbox: 'checkbox',
  Image: 'image',
  Radio: 'radio',
  Range: 'range',
  Search: 'search',
};

export type InputType = Values<typeof InputTypes>;

export const InputValidationStates = {
  None: 'none',
  Valid: 'valid',
  Invalid: 'invalid',
  Loading: 'loading',
  Initial: 'initial',
};

export type InputValidationState = Values<typeof InputValidationStates>;

export const InputBottomTreatments = {
  Flat: 'flat',
  Rounded: 'rounded',
} as const;
export type InputBottomTreatment = Values<typeof InputBottomTreatments>;

export interface Signature {
  Args: {
    bottomTreatment?: InputBottomTreatment;
    disabled?: boolean;
    errorMessage?: string;
    helperText?: string;
    id?: string;
    onBlur?: (ev: Event) => void;
    onFocus?: (ev: Event) => void;
    onInput?: (val: string) => void;
    onKeyPress?: (ev: KeyboardEvent) => void;
    optional?: boolean;
    placeholder?: string;
    required?: boolean;
    state?: InputValidationState;
    type?: InputType;
    value: string | number | null | undefined;
    variant?: 'large' | 'default';
  };
  Element: HTMLInputElement | HTMLTextAreaElement;
}

export default class BoxelInput extends Component<Signature> {
  private guid = guidFor(this);

  private get id() {
    return this.args.id || this.guid;
  }

  private get isMultiline() {
    return this.args.type === 'textarea';
  }

  get isSearch() {
    return this.args.type === 'search';
  }

  private get type() {
    let type = this.args.type;

    if (type === InputTypes.Textarea) {
      return undefined;
    }

    return type;
  }

  private get hasValidation() {
    return this.args.state && this.args.state !== 'none';
  }

  private get isInvalid() {
    return this.args.state === 'invalid';
  }

  private get validationIcon(): Icon | undefined {
    if (this.args.disabled) {
      return undefined;
    }
    switch (this.args.state) {
      case 'valid':
        return SuccessBordered;
      case 'invalid':
        return FailureBordered;
      case 'loading':
        return LoadingIndicator;
      default:
        return undefined;
    }
  }

  private get shouldShowErrorMessage() {
    return this.isInvalid && this.args.errorMessage;
  }

  <template>
    <div
      class={{cn
        'input-container'
        has-validation=this.hasValidation
        is-multiline=this.isMultiline
      }}
    >
      {{#if (and (not @required) @optional)}}
        <div class='optional'>Optional</div>
      {{/if}}
      {{#let (element (if this.isMultiline 'textarea' 'input')) as |InputTag|}}
        <InputTag
          class={{cn
            'boxel-input'
            has-validation=this.hasValidation
            invalid=this.isInvalid
            search=this.isSearch
            boxel-input--large=(eq @variant 'large')
            boxel-input--bottom-flat=(eq @bottomTreatment 'flat')
          }}
          id={{this.id}}
          type={{this.type}}
          value={{@value}}
          placeholder={{@placeholder}}
          required={{@required}}
          disabled={{@disabled}}
          aria-describedby={{if
            @helperText
            (concat 'helper-text-' this.guid)
            false
          }}
          aria-invalid={{if this.isInvalid 'true'}}
          aria-errormessage={{if
            this.shouldShowErrorMessage
            (concat 'error-message-' this.guid)
            false
          }}
          data-test-boxel-input
          data-test-boxel-input-id={{@id}}
          data-test-boxel-input-validation-state={{if @disabled false @state}}
          {{on 'input' (pick 'target.value' (optional @onInput))}}
          {{on 'blur' (optional @onBlur)}}
          {{on 'keypress' (optional @onKeyPress)}}
          {{on 'focus' (optional @onFocus)}}
          ...attributes
        />
        {{#if this.isSearch}}
          <div
            class={{cn
              'search-icon-container'
              has-validation=this.hasValidation
            }}
          >
            <IconSearch class='search-icon' width='20' height='20' />
          </div>
        {{/if}}
        {{#if this.validationIcon}}
          <div class='validation-icon-container'>
            <this.validationIcon role='presentation' />
          </div>
        {{/if}}
        {{#if this.shouldShowErrorMessage}}
          <div
            id={{concat 'error-message-' this.guid}}
            class='error-message'
            aria-live='polite'
            data-test-boxel-input-error-message
          >{{@errorMessage}}</div>
        {{/if}}
        {{#if @helperText}}
          <div
            id={{concat 'helper-text-' this.guid}}
            class='helper-text'
            data-test-boxel-input-helper-text
          >{{@helperText}}</div>
        {{/if}}
      {{/let}}
    </div>
    <style>
      .input-container {
        --icon-size: var(--boxel-icon-sm);
        --icon-space: var(--boxel-sp-xs);
        --icon-full-length: calc(var(--boxel-icon-sm) + var(--boxel-sp-xs) * 2);

        display: grid;
        grid-template-columns: var(--icon-full-length) 1fr var(
            --icon-full-length
          );
        grid-template-areas:
          'optional optional optional'
          'pre-icon input post-icon'
          'error error error'
          'helper helper helper';
      }

      .boxel-input {
        --boxel-input-height: var(--boxel-form-control-height);

        grid-column: 1 / span 3;
        grid-row: 2;

        box-sizing: border-box;
        width: 100%;
        min-height: var(--boxel-input-height);
        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
        font: var(--boxel-font-sm);
        font-weight: 400;
        letter-spacing: var(--boxel-lsp-xs);
        transition: border-color var(--boxel-transition);
      }

      .boxel-input--large {
        --boxel-form-control-height: 4.375rem;

        font: var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .boxel-text-area {
        --boxel-input-height: 10rem;
      }

      .boxel-input:disabled {
        background-color: var(--boxel-light);
        border-color: var(--boxel-purple-300);
        color: rgb(0 0 0 / 50%);
        opacity: 0.5;
      }

      .boxel-input:hover:not(:disabled) {
        border-color: var(--boxel-dark);
      }

      .invalid {
        border-color: var(--boxel-error-100);
        box-shadow: 0 0 0 1px var(--boxel-error-100);
      }

      .invalid:focus {
        outline: 1px solid transparent; /* Make sure that we make the invalid state visible */
        box-shadow: 0 0 0 1.5px var(--boxel-error-100);
      }

      .invalid:hover:not(:disabled) {
        border-color: var(--boxel-error-100);
      }

      .search {
        --boxel-form-control-border-color: var(--boxel-dark);
        --boxel-form-control-border-radius: var(--boxel-border-radius-xl);

        background-color: var(--boxel-dark);
        color: var(--boxel-light);
        padding-right: var(--boxel-sp-xl);
      }

      .search.has-validation {
        padding-right: unset;
        padding-left: var(--boxel-sp-xl);
      }

      .boxel-input--bottom-flat {
        --boxel-form-control-border-radius: var(--boxel-border-radius-xl)
          var(--boxel-border-radius-xl) 0 0;
      }

      .search-icon-container {
        --icon-color: var(--boxel-highlight);

        grid-area: post-icon;

        display: flex;
        height: 100%;
        align-items: center;
        justify-content: center;
      }

      .search-icon-container.has-validation {
        grid-area: pre-icon;
      }

      .validation-icon-container {
        grid-area: post-icon;

        display: flex;
        align-items: center;
        justify-content: center;
        user-select: none;
      }

      .optional {
        grid-area: optional;

        margin-bottom: var(--boxel-sp-xxxs);
        color: rgb(0 0 0 / 75%);
        font: var(--boxel-font-sm);
        font-style: oblique;
        letter-spacing: var(--boxel-lsp);
        text-align: right;
      }

      .error-message {
        grid-area: error;

        margin-top: var(--boxel-sp-xxxs);
        margin-left: calc(var(--boxel-sp-sm) + 1px);
        color: var(--boxel-error-200);
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
      }

      .helper-text {
        grid-area: helper;

        margin-top: var(--boxel-sp-xs);
        margin-left: calc(var(--boxel-sp-sm) + 1px);
        color: rgb(0 0 0 / 75%);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
      }

      .boxel-input:disabled ~ .error-message,
      .boxel-input:disabled ~ .helper-text {
        display: none;
      }

      .boxel-input.search::placeholder {
        color: var(--boxel-light);
        opacity: 0.6;
      }
    </style>
  </template>
}
