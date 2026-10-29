import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';

import cn from '../helpers/cn.ts';
import optional from '../helpers/optional.ts';
import FailureBordered from './icons/failure-bordered.gts';
import SuccessBordered from './icons/success-bordered.gts';
import type { IconComponent } from './icons/types.ts';

// boxel-ui's BoxelInput, for the inputs the secure origin's pages draw.
// boxel-ui's can't ship on the secure origin (ADR 008 §1.3), so its template
// and styles are brought here, kept as they are there, but for what the pages
// don't draw: other kinds of input (search, checkbox, color), the large size,
// the flat bottom, the loading state, helper text, the optional marker, and
// disabled and read-only inputs.
//
// A textarea grows with what it holds (`field-sizing: content`), where
// boxel-ui's starts 10rem tall, so a field holding a short list shows all of
// it and no more. Where the browser doesn't size a field by its content, the
// textarea is as many rows tall as the value has lines.
//
// Unlike boxel-ui's, an error message describes the input
// (`aria-describedby`) as well as being its `aria-errormessage`, which screen
// readers announce unevenly. A field names its input by its label alone (see
// FieldContainer), so this is how the error is read with the field.
export type InputValidationState = 'none' | 'valid' | 'invalid' | 'initial';

export interface Signature {
  Args: {
    autocomplete?: string;
    errorMessage?: string;
    id?: string;
    onBlur?: (ev: Event) => void;
    onChange?: (ev: Event) => void;
    onFocus?: (ev: Event) => void;
    onInput?: (val: string) => void;
    onKeyPress?: (ev: KeyboardEvent) => void;
    placeholder?: string;
    state?: InputValidationState;
    type?: 'text' | 'password' | 'email' | 'tel' | 'url' | 'textarea';
    value?: string | null;
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

  private get rows() {
    return Math.max(1, (this.args.value ?? '').split('\n').length);
  }

  private get hasValidation() {
    return this.args.state && this.args.state !== 'none';
  }

  private get hasValidationIcon() {
    return Boolean(this.validationIcon);
  }

  private get isInvalid() {
    return this.args.state === 'invalid';
  }

  private get validationIcon(): IconComponent | undefined {
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

  private get errorMessageId() {
    return this.shouldShowErrorMessage
      ? `error-message-${this.guid}`
      : undefined;
  }

  private onInput = (event: Event) => {
    this.args.onInput?.(
      (event.target as HTMLInputElement | HTMLTextAreaElement).value,
    );
  };

  private onKeyPress = (event: Event) => {
    this.args.onKeyPress?.(event as KeyboardEvent);
  };

  <template>
    <div class={{cn 'input-container' has-validation=this.hasValidation}}>
      {{#if this.isMultiline}}
        <textarea
          class={{cn
            'boxel-input'
            has-validation=this.hasValidation
            has-validation-icon=this.hasValidationIcon
            invalid=this.isInvalid
          }}
          id={{this.id}}
          rows={{this.rows}}
          value={{@value}}
          placeholder={{@placeholder}}
          autocomplete={{@autocomplete}}
          aria-describedby={{this.errorMessageId}}
          aria-invalid={{if this.isInvalid 'true'}}
          aria-errormessage={{this.errorMessageId}}
          data-test-boxel-input
          data-test-boxel-input-id={{@id}}
          data-test-boxel-input-validation-state={{@state}}
          {{on 'input' this.onInput}}
          {{on 'blur' (optional @onBlur)}}
          {{on 'keypress' this.onKeyPress}}
          {{on 'focus' (optional @onFocus)}}
          {{on 'change' (optional @onChange)}}
          ...attributes
        ></textarea>
      {{else}}
        <input
          class={{cn
            'boxel-input'
            has-validation=this.hasValidation
            has-validation-icon=this.hasValidationIcon
            invalid=this.isInvalid
          }}
          id={{this.id}}
          type={{@type}}
          value={{@value}}
          placeholder={{@placeholder}}
          autocomplete={{@autocomplete}}
          aria-describedby={{this.errorMessageId}}
          aria-invalid={{if this.isInvalid 'true'}}
          aria-errormessage={{this.errorMessageId}}
          data-test-boxel-input
          data-test-boxel-input-id={{@id}}
          data-test-boxel-input-validation-state={{@state}}
          {{on 'input' this.onInput}}
          {{on 'blur' (optional @onBlur)}}
          {{on 'keypress' this.onKeyPress}}
          {{on 'focus' (optional @onFocus)}}
          {{on 'change' (optional @onChange)}}
          ...attributes
        />
      {{/if}}
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
          id={{this.errorMessageId}}
          class='error-message'
          aria-live='polite'
          data-test-boxel-input-error-message
        >{{@errorMessage}}</div>
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
          padding-block: var(--boxel-sp-xs);
          padding-inline: var(--boxel-sp-sm)
            var(--boxel-input-padding-inline-end, 0);
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

        textarea.boxel-input {
          field-sizing: content;
          resize: vertical;
          overflow: auto;
        }

        /* keep text out from under the validation icon */
        .boxel-input.has-validation-icon {
          padding-inline-end: var(--_icon-full-length);
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

        .error-message {
          grid-area: error;

          margin-top: var(--boxel-sp-3xs);
          margin-inline-start: calc(var(--boxel-sp-sm) + 1px);
          color: var(--destructive-ink);
          font-size: var(--boxel-font-size-sm);
          font-weight: 500;
          letter-spacing: var(--boxel-lsp);
        }
      }
    </style>
  </template>
}
