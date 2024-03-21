import { concat, hash } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';

import cn from '../../helpers/cn.ts';
import { and, bool, eq, or } from '../../helpers/truth-helpers.ts';
import SuccessBordered from '../../icons/check-mark.gts';
import FailureBordered from '../../icons/failure-bordered.gts';
import type { Icon } from '../../icons/types.ts';
import { type InputValidationState } from '../input/index.gts';
import LoadingIndicator from '../loading-indicator/index.gts';
import {
  type AccessoriesBlockArg,
  Button as ButtonAccessory,
  IconButton as IconButtonAccessory,
  Select as SelectAccessory,
  Text as TextAccessory,
} from './accessories/index.gts';
import {
  type ControlsBlockArg,
  Input as InputControl,
  Textarea as TextareaControl,
} from './controls/index.gts';

export interface InputGroupBlockArg {
  elementId: string;
}

export interface Signature {
  Args: {
    autocomplete?: string;
    disabled?: boolean;
    errorMessage?: string;
    helperText?: string;
    id?: string;
    inputmode?: string;
    onBlur?: (ev: Event) => void;
    onFocus?: (ev: Event) => void;
    onInput?: (val: string) => void;
    placeholder?: string;
    readonly?: boolean;
    required?: boolean;
    state?: InputValidationState;
    value?: string;
  };
  Blocks: {
    after: [AccessoriesBlockArg, InputGroupBlockArg];
    before: [AccessoriesBlockArg, InputGroupBlockArg];
    default: [ControlsBlockArg, AccessoriesBlockArg, InputGroupBlockArg];
  };
  Element: HTMLElement;
}

export default class InputGroup extends Component<Signature> {
  get elementId() {
    return this.args.id || guidFor(this);
  }
  get inputGroupBlockArg() {
    return {
      elementId: this.elementId,
    };
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
      default:
        return undefined;
    }
  }

  <template>
    {{#let
      (and (eq @state 'invalid') (bool @errorMessage))
      (hash
        Button=(component ButtonAccessory kind='secondary-light')
        IconButton=IconButtonAccessory
        Select=SelectAccessory
        Text=TextAccessory
      )
      (hash Input=InputControl Textarea=TextareaControl)
      as |shouldShowErrorMessage Accessories Controls|
    }}
      <div class='container'>
        <div
          class={{cn
            'boxel-input-group'
            boxel-input-group--invalid=(eq @state 'invalid')
            boxel-input-group--disabled=(or @disabled (eq @state 'loading'))
          }}
          data-test-boxel-input-group
          data-test-boxel-input-group-validation-state={{if
            @disabled
            false
            @state
          }}
          ...attributes
        >
          {{yield Accessories this.inputGroupBlockArg to='before'}}
          {{#if (has-block 'default')}}
            {{yield Controls Accessories this.inputGroupBlockArg}}
          {{else}}
            <InputControl
              id={{this.elementId}}
              @placeholder={{@placeholder}}
              @disabled={{or @disabled (eq @state 'loading')}}
              @readonly={{@readonly}}
              @required={{@required}}
              @value={{@value}}
              @onInput={{@onInput}}
              @onFocus={{@onFocus}}
              @onBlur={{@onBlur}}
              autocomplete={{@autocomplete}}
              inputmode={{@inputmode}}
              aria-describedby={{if
                @helperText
                (concat 'helper-text-' this.elementId)
                false
              }}
              aria-invalid={{if (eq @state 'invalid') 'true'}}
              aria-errormessage={{if
                shouldShowErrorMessage
                (concat 'error-message-' this.elementId)
                false
              }}
            />
          {{/if}}
          {{yield Accessories this.inputGroupBlockArg to='after'}}
          {{#if this.validationIcon}}
            <div class={{cn 'validation-icon-container' @state}}>
              <this.validationIcon />
            </div>
          {{else if (eq @state 'loading')}}
            <div class={{cn 'validation-icon-container' @state}}>
              <LoadingIndicator />
            </div>
          {{/if}}
        </div>
        {{#if shouldShowErrorMessage}}
          <div
            id={{concat 'error-message-' this.elementId}}
            class='error-message'
            data-test-boxel-input-group-error-message
          >{{@errorMessage}}</div>
        {{/if}}
        {{#if @helperText}}
          <div
            id={{concat 'helper-text-' this.elementId}}
            class='helper-text'
            data-test-boxel-input-group-helper-text
          >{{@helperText}}</div>
        {{/if}}
      </div>
    {{/let}}
    <style>
      .container {
        display: flex;
        flex-direction: column;
      }
      .boxel-input-group {
        --boxel-input-group-padding-x: var(--boxel-sp-sm);
        --boxel-input-group-padding-y: var(--boxel-sp-xxs);
        --boxel-input-group-border-color: var(
          --boxel-form-control-border-color
        );
        --boxel-input-group-border-radius: var(
          --boxel-form-control-border-radius
        );
        --boxel-input-group-interior-border-width: 0;
        --boxel-input-group-height: calc(
          (var(--boxel-ratio) * var(--boxel-font-size)) +
            (2 * var(--boxel-input-group-padding-y)) + 2px
        );
        --boxel-input-group-icon-length: calc(
          var(--boxel-icon-sm) + var(--boxel-sp-xs) * 2
        );

        border-radius: var(--boxel-input-group-border-radius);
        cursor: text;
        font-family: var(--boxel-font-family);
        font-size: var(--boxel-font-size);
        line-height: var(--boxel-ratio);
        letter-spacing: var(--boxel-lsp-xs);
        position: relative;
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        width: 100%;
        min-height: var(--boxel-input-group-height);
      }

      .boxel-input-group :deep(.boxel-button--size-base) {
        /* TODO: do this in a way that doesn't violate Boxel::Button */
        --boxel-button-min-height: var(--boxel-input-group-height);
      }

      .boxel-input-group:not(:focus-within):not(
          .boxel-input-group--invalid
        ):not(.boxel-input-group--disabled):hover {
        outline: 1px solid var(--boxel-dark) !important;
      }

      .boxel-input-group:not(.boxel-input-group--invalid):focus-within {
        outline: 2px solid var(--boxel-highlight);
      }

      .boxel-input-group--disabled :deep(.form-control),
      .boxel-input-group--disabled :deep(.text-accessory),
      .boxel-input-group--disabled :deep(.icon-button-accessory),
      .boxel-input-group--disabled :deep(.button-accessory) {
        border-color: var(--boxel-input-group-border-color);
        color: rgb(0 0 0 / 50%);
        opacity: 0.5;
      }

      .boxel-input-group > :last-child {
        border-top-right-radius: var(--boxel-input-group-border-radius);
        border-bottom-right-radius: var(--boxel-input-group-border-radius);
      }

      .boxel-input-group > :not(:last-child) {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        border-right-width: var(--boxel-input-group-interior-border-width);
      }

      .boxel-input-group > :first-child {
        border-top-left-radius: var(--boxel-input-group-border-radius);
        border-bottom-left-radius: var(--boxel-input-group-border-radius);
      }

      .boxel-input-group > :not(:first-child) {
        margin-left: -1px;
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
        border-left-width: var(--boxel-input-group-interior-border-width);
      }

      .helper-text {
        margin-top: var(--boxel-sp-xs);
        margin-left: var(--boxel-sp-xs);
        color: rgb(0 0 0 / 75%);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
      }

      .boxel-input-group--invalid:not(.boxel-input-group--disabled) {
        box-shadow: 0 0 0 1px var(--boxel-error-100);
      }

      .boxel-input-group--invalid:not(.boxel-input-group--disabled)
        .validation-icon-container,
      .boxel-input-group--invalid:not(.boxel-input-group--disabled)
        :deep(.form-control),
      .boxel-input-group--invalid:not(.boxel-input-group--disabled)
        :deep(.text-accessory),
      .boxel-input-group--invalid:not(.boxel-input-group--disabled)
        :deep(.icon-button-accessory),
      .boxel-input-group--invalid:not(.boxel-input-group--disabled)
        :deep(.button-accessory) {
        border-color: var(--boxel-error-100);
      }

      .boxel-input-group--disabled ~ .error-message,
      .boxel-input-group--disabled ~ .helper-text {
        display: none;
      }

      .error-message {
        margin-top: var(--boxel-sp-xxxs);
        margin-left: calc(var(--boxel-sp-sm) + 1px);
        color: var(--boxel-error-200);
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
      }

      .validation-icon-container {
        display: flex;
        border: 1px solid var(--boxel-input-group-border-color);
        align-items: center;
        justify-content: center;
        user-select: none;
        width: var(--boxel-input-group-icon-length);
      }
      .validation-icon-container.valid {
        --icon-color: var(--boxel-dark-green);
      }
    </style>
  </template>
}
