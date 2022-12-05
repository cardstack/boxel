import Component from '@glimmer/component';
// import { type EmptyObject } from '@ember/component/helper';
// import cn from '@cardstack/boxel/helpers/cn';
// import and from 'ember-truth-helpers/helpers/and';
// import not from 'ember-truth-helpers/helpers/not';
// import { concat } from '@ember/helper';
// import element from 'ember-element-helper/helpers/element';
import { on } from '@ember/modifier';
// import optional from 'ember-composable-helpers/helpers/optional';
// import pick from 'ember-composable-helpers/helpers/pick';
import { pick } from '../pick';
// import { guidFor } from '@ember/object/internals';

import { initStyleSheet, attachStyles } from '../attach-styles';

// import '@cardstack/boxel/styles/global.css';
// import './index.css';
// import './token-amount/index.css';
// import './validation-state/index.css';

export interface Signature {
  Element: HTMLInputElement | HTMLTextAreaElement;
  Args: {
    errorMessage?: string;
    helperText?: string;
    id?: string;
    disabled?: boolean;
    invalid?: boolean;
    multiline?: boolean;
    value: string | number | null;
    onInput?: (val: string) => void;
    onBlur?: (ev: Event) => void;
    required?: boolean;
    optional?: boolean;
  };
  // Blocks: EmptyObject;
}

let styles = initStyleSheet(`
  this {
    --boxel-font-family: "Open Sans", helvetica, arial, sans-serif;
    --boxel-font-size: 1rem;
    --boxel-font: var(--boxel-font-size)/calc(22 / 16) var(--boxel-font-family);
    --boxel-sp: 1.25rem;
    --boxel-sp-xxs: 0.5em;
    --boxel-lsp-sm: 0.015em;
    --boxel-transition: 0.2s ease;

    --boxel-form-control-border-color: #afafb7;
    --boxel-form-control-border-radius: 5px;

    --boxel-input-height: var(--boxel-form-control-height);

    // width: 100%;
    min-height: var(--boxel-input-height);
    padding: var(--boxel-sp-xxs) 0 var(--boxel-sp-xxs) var(--boxel-sp);
    border: 1px solid var(--boxel-form-control-border-color);
    border-radius: var(--boxel-form-control-border-radius);
    font: var(--boxel-font);
    letter-spacing: var(--boxel-lsp-sm);
    transition: border-color var(--boxel-transition);
  }
`);

export default class BoxelInput extends Component<Signature> {
  // helperId = guidFor(this);
  // get id() {
  //   return this.args.id || this.helperId;
  // }

  <template>
    {{!-- {{#if (and (not @required) @optional)}}
      <div class="boxel-input__optional">Optional</div>
    {{/if}} --}}
    {{!-- {{#let (and @invalid @errorMessage) as |shouldShowErrorMessage|}} --}}
      {{!-- {{#let (element (if @multiline "textarea" "input")) as |InputTag|}} --}}
        <input
          {{!-- class={{cn "boxel-input" boxel-input--invalid=@invalid}} --}}
          {{!-- id={{this.id}} --}}
          value={{@value}}
          required={{@required}}
          disabled={{@disabled}}
          {{!-- aria-describedby={{if @helperText (concat "helper-text-" this.helperId) false}} --}}
          aria-invalid={{if @invalid "true"}}
          {{!-- aria-errormessage={{if shouldShowErrorMessage (concat "error-message-" this.helperId) false}} --}}
          data-test-boxel-input
          {{!-- data-test-boxel-input-id={{@id}} --}}
          {{on "input" (pick "target.value" @set) }}
          {{!-- {{on "input" (pick "target.value" (optional @onInput))}}
          {{on "blur" (optional @onBlur)}} --}}
          {{attachStyles styles}}
          ...attributes
        />
        {{!-- {{#if shouldShowErrorMessage}}
          <div id={{concat "error-message-" this.helperId}} class="boxel-input__error-message" aria-live="polite" data-test-boxel-input-error-message>{{@errorMessage}}</div>
        {{/if}} --}}
        {{!-- {{#if @helperText}}
          <div id={{concat "helper-text-" this.helperId}} class="boxel-input__helper-text" data-test-boxel-input-helper-text>{{@helperText}}</div>
        {{/if}} --}}
      {{!-- {{/let}} --}}
    {{!-- {{/let}} --}}
  </template>
}
