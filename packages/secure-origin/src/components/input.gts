import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';

import cn from '../helpers/cn.ts';
import optional from '../helpers/optional.ts';
import { and, not } from '../helpers/truth-helpers.ts';
import FailureBordered from './icons/failure-bordered.gts';
import SuccessBordered from './icons/success-bordered.gts';
import type { IconComponent } from './icons/types.ts';

// boxel-ui's BoxelInput, for the single-line inputs the secure origin's pages
// draw. boxel-ui's can't ship on the secure origin (ADR 008 §1.3), so its
// template and styles are brought here, kept as they are there, but for the
// kinds of input the pages don't draw (textarea, search, checkbox, color, the
// large size, the flat bottom and the loading state).
export type InputValidationState = 'none' | 'valid' | 'invalid' | 'initial';

export interface Signature {
  Args: {
    autocomplete?: string;
    disabled?: boolean;
    errorMessage?: string;
    helperText?: string;
    id?: string;
    onBlur?: (ev: Event) => void;
    onChange?: (ev: Event) => void;
    onFocus?: (ev: Event) => void;
    onInput?: (val: string) => void;
    onKeyPress?: (ev: KeyboardEvent) => void;
    optional?: boolean;
    placeholder?: string;
    readonly?: boolean;
    required?: boolean;
    state?: InputValidationState;
    type?: 'text' | 'password' | 'email' | 'tel' | 'url';
    value?: string | null;
  };
  Element: HTMLInputElement;
}

export default class BoxelInput extends Component<Signature> {
  private guid = guidFor(this);

  private get id() {
    return this.args.id || this.guid;
  }

  private get hasValidation() {
    return this.args.state && this.args.state !== 'none';
  }

  private get isInvalid() {
    return this.args.state === 'invalid';
  }

  private get validationIcon(): IconComponent | undefined {
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

  private get shouldShowErrorMessage() {
    return this.isInvalid && this.args.errorMessage;
  }

  private onInput = (event: Event) => {
    this.args.onInput?.((event.target as HTMLInputElement).value);
  };

  private onKeyPress = (event: Event) => {
    this.args.onKeyPress?.(event as KeyboardEvent);
  };

  <template>
    <div class={{cn 'input-container' has-validation=this.hasValidation}}>
      {{#if (and (not @required) @optional)}}
        <div class='optional'>Optional</div>
      {{/if}}
      <input
        class={{cn
          'boxel-input'
          has-validation=this.hasValidation
          invalid=this.isInvalid
        }}
        id={{this.id}}
        type={{@type}}
        value={{@value}}
        placeholder={{@placeholder}}
        required={{@required}}
        disabled={{@disabled}}
        readonly={{@readonly}}
        autocomplete={{@autocomplete}}
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
        {{on 'input' this.onInput}}
        {{on 'blur' (optional @onBlur)}}
        {{on 'keypress' this.onKeyPress}}
        {{on 'focus' (optional @onFocus)}}
        {{on 'change' (optional @onChange)}}
        ...attributes
      />
      {{#if this.validationIcon}}
        <div class='validation-icon-container'>
          <this.validationIcon
            class='validation-icon-{{@state}}'
            role='presentation'
          />
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
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .input-container {
          --icon-size: var(--boxel-icon-sm);
          --icon-space: var(--boxel-sp-xs);
          --_icon-full-length: var(
            --boxel-input-icon-size,
            calc(var(--icon-size) + var(--icon-space) * 2)
          );

          display: grid;
          grid-template-columns:
            var(--_icon-full-length)
            1fr
            var(--_icon-full-length);
          grid-template-areas:
            'optional optional optional'
            'pre-icon input post-icon'
            'error error error'
            'helper helper helper';
          width: 100%;
        }

        .boxel-input {
          grid-column: 1 / span 3;
          grid-row: 2;

          box-sizing: border-box;
          width: var(--boxel-input-width, 100%);
          min-width: 0;
          max-width: 100%;
          min-height: var(
            --boxel-input-height,
            var(--boxel-form-control-height)
          );
          padding: var(--boxel-sp-xs) 0 var(--boxel-sp-xs) var(--boxel-sp-sm);
          background-color: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          border: 1px solid
            var(--border, var(--boxel-form-control-border-color));
          border-radius: var(--boxel-form-control-border-radius);
          box-shadow: var(--boxel-form-control-box-shadow);
          outline: var(--boxel-input-outline, 1px solid transparent);
          transition:
            var(--boxel-transition-properties),
            outline-color var(--boxel-transition);
        }

        .boxel-input:disabled {
          opacity: 0.5;
        }

        .boxel-input[readonly] {
          opacity: 0.5;
        }

        .boxel-input:focus-visible {
          outline-color: var(--ring, var(--boxel-highlight));
          border-color: var(--ring, var(--boxel-highlight));
        }

        .boxel-input::placeholder {
          color: var(--muted-foreground, var(--boxel-450));
        }

        .boxel-input:hover:not(:focus-visible):not(:disabled):not(.invalid) {
          border-color: currentColor;
        }

        .invalid:not(:disabled) {
          border-color: var(--destructive, var(--boxel-error-100));
          box-shadow: 0 0 0 1px var(--destructive, var(--boxel-error-100));
        }

        .invalid:focus-visible {
          outline: 1px solid transparent; /* Make sure that we make the invalid state visible */
          box-shadow: 0 0 0 1.5px var(--destructive, var(--boxel-error-100));
        }

        .invalid:hover:not(:disabled) {
          border-color: var(--destructive, var(--boxel-error-100));
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
          justify-self: end;

          margin-bottom: var(--boxel-sp-xxxs);
          font-size: var(
            --boxel-input-optional-font-size,
            var(--boxel-font-size-xs)
          );
          font-style: oblique;
          letter-spacing: var(--boxel-lsp);
          opacity: 0.75;
        }

        .error-message {
          grid-area: error;

          margin-top: var(--boxel-sp-xxxs);
          margin-left: calc(var(--boxel-sp-sm) + 1px);
          color: var(--destructive-ink);
          font-size: var(--boxel-font-size-sm);
          font-weight: 500;
          letter-spacing: var(--boxel-lsp);
        }

        .helper-text {
          grid-area: helper;

          margin-top: var(--boxel-sp-xs);
          margin-left: calc(var(--boxel-sp-sm) + 1px);
          font-size: var(--boxel-font-size-sm);
          letter-spacing: var(--boxel-lsp);
          opacity: 0.75;
        }

        .boxel-input:disabled ~ .error-message,
        .boxel-input:disabled ~ .helper-text {
          display: none;
        }
      }
    </style>
  </template>
}
