import Component from '@glimmer/component';
import { type EmptyObject } from '@ember/component/helper';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import pick from '@cardstack/boxel-ui/helpers/pick';
import optional from '@cardstack/boxel-ui/helpers/optional';
import { and, not, bool } from '@cardstack/boxel-ui/helpers/truth-helpers';
import element from '@cardstack/boxel-ui/helpers/element';
import cn from '@cardstack/boxel-ui/helpers/cn';
import './style.css';

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

export default class BoxelInput extends Component<Signature> {
  helperId = guidFor(this);
  get id() {
    return this.args.id || this.helperId;
  }

  <template>
    {{#if (and (not @required) @optional)}}
      <div class='boxel-input__optional'>Optional</div>
    {{/if}}
    {{#let (and @invalid (bool @errorMessage)) as |shouldShowErrorMessage|}}
      {{#let (element (if @multiline 'textarea' 'input')) as |InputTag|}}
        <InputTag
          class={{cn 'boxel-input' boxel-input--invalid=@invalid}}
          id={{this.id}}
          value={{@value}}
          required={{@required}}
          disabled={{@disabled}}
          aria-describedby={{if
            @helperText
            (concat 'helper-text-' this.helperId)
            false
          }}
          aria-invalid={{if @invalid 'true'}}
          aria-errormessage={{if
            shouldShowErrorMessage
            (concat 'error-message-' this.helperId)
            false
          }}
          data-test-boxel-input
          data-test-boxel-input-id={{@id}}
          {{on 'input' (pick 'target.value' (optional @onInput))}}
          {{on 'blur' (optional @onBlur)}}
          ...attributes
        />
        {{#if shouldShowErrorMessage}}
          <div
            id={{concat 'error-message-' this.helperId}}
            class='boxel-input__error-message'
            aria-live='polite'
            data-test-boxel-input-error-message
          >{{@errorMessage}}</div>
        {{/if}}
        {{#if @helperText}}
          <div
            id={{concat 'helper-text-' this.helperId}}
            class='boxel-input__helper-text'
            data-test-boxel-input-helper-text
          >{{@helperText}}</div>
        {{/if}}
      {{/let}}
    {{/let}}
  </template>
}
