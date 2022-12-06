import Component from '@glimmer/component';
import { type EmptyObject } from '@ember/component/helper';
import { and, not } from '../helpers/truth-helpers';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { pick } from '../../pick';
import { initStyleSheet, attachStyles } from '../../attach-styles';
import optional from '../helpers/optional';
import { boxelCssVariables } from './boxel-css-variables';

export interface Signature {
  Element: HTMLInputElement | HTMLTextAreaElement;
  Args: {
    errorMessage?: string;
    helperText?: string;
    id?: string;
    disabled?: boolean;
    invalid?: boolean;
    multiline?: boolean;
    value: string | number | null | undefined;
    onInput?: (val: string) => void;
    onBlur?: (ev: Event) => void;
    required?: boolean;
    optional?: boolean;
  };
  Blocks: EmptyObject;
}

let styles = initStyleSheet(`
  this {
    ${boxelCssVariables};
  }

  .boxel-input {
    --boxel-form-control-border-color: #afafb7;
    --boxel-form-control-border-radius: 5px;

    min-height: var(--boxel-input-height);
    padding: var(--boxel-sp-xxs) 0 var(--boxel-sp-xxs) var(--boxel-sp-xxs);
    border: 1px solid var(--boxel-form-control-border-color);
    border-radius: var(--boxel-form-control-border-radius);
    font: inherit;
    letter-spacing: var(--boxel-lsp-sm);
    transition: border-color var(--boxel-transition);
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

  .boxel-input--invalid {
    border-color: var(--boxel-error-100);
    box-shadow: 0 0 0 1px var(--boxel-error-100);
  }

  .boxel-input--invalid:focus {
    outline: 1px solid transparent;  /* Make sure that we make the invalid state visible */
    box-shadow: 0 0 0 1.5px var(--boxel-error-100);
  }

  .boxel-input--invalid:hover:not(:disabled) {
    border-color: var(--boxel-error-100);
  }

  .boxel-input__optional {
    grid-row: 1;
    grid-column: 1 / -1;
    margin-bottom: var(--boxel-sp-xxxs);
    color: rgb(0 0 0 / 75%);
    font: var(--boxel-font-sm);
    font-style: oblique;
    letter-spacing: var(--boxel-lsp);
    text-align: right;
  }

  .boxel-input__error-message {
    grid-column: 2;
    margin-top: var(--boxel-sp-xs);
    margin-left: var(--boxel-sp-xs);
    color: var(--boxel-error-100);
    font: var(--boxel-font-sm);
    letter-spacing: var(--boxel-lsp);
  }

  .boxel-input__helper-text {
    grid-column: 2;
    margin-top: var(--boxel-sp-xs);
    margin-left: var(--boxel-sp-xs);
    color: rgb(0 0 0 / 75%);
    font: var(--boxel-font-sm);
    letter-spacing: var(--boxel-lsp);
  }

  .boxel-input:disabled ~ .boxel-input__error-message,
  .boxel-input:disabled ~ .boxel-input__helper-text {
    display: none;
  }
`);

export default class BoxelInput extends Component<Signature> {
  helperId = guidFor(this);
  get id() {
    return this.args.id || this.helperId;
  }

  <template>
    {{#if (and (not @required) @optional)}}
      <div class="boxel-input__optional">Optional</div>
    {{/if}}
    {{#let (and @invalid @errorMessage) as |shouldShowErrorMessage|}}
      {{#if @multiline}}
        <textarea
          class="boxel-input {{if @invalid "boxel-input--invalid"}}"
          id={{this.id}}
          value={{@value}}
          required={{@required}}
          disabled={{@disabled}}
          aria-describedby={{if @helperText (concat "helper-text-" this.helperId) false}}
          aria-invalid={{if @invalid "true"}}
          aria-errormessage={{if shouldShowErrorMessage (concat "error-message-" this.helperId) false}}
          data-test-boxel-input
          data-test-boxel-input-id={{@id}}
          {{on "input" (pick "target.value" (optional @onInput))}}
          {{on "blur" (optional @onBlur)}}
          {{attachStyles styles}}
          ...attributes
        />
      {{else}}
        <input
          class="boxel-input {{if @invalid "boxel-input--invalid"}}"
          id={{this.id}}
          value={{@value}}
          required={{@required}}
          disabled={{@disabled}}
          aria-describedby={{if @helperText (concat "helper-text-" this.helperId) false}}
          aria-invalid={{if @invalid "true"}}
          aria-errormessage={{if shouldShowErrorMessage (concat "error-message-" this.helperId) false}}
          data-test-boxel-input
          data-test-boxel-input-id={{@id}}
          {{on "input" (pick "target.value" (optional @onInput))}}
          {{on "blur" (optional @onBlur)}}
          {{attachStyles styles}}
          ...attributes
        />
      {{/if}}
      {{#if shouldShowErrorMessage}}
        <div id={{concat "error-message-" this.helperId}} class="boxel-input__error-message" aria-live="polite" data-test-boxel-input-error-message>{{@errorMessage}}</div>
      {{/if}}
      {{#if @helperText}}
        <div id={{concat "helper-text-" this.helperId}} class="boxel-input__helper-text" data-test-boxel-input-helper-text>{{@helperText}}</div>
      {{/if}}
    {{/let}}
  </template>
}
