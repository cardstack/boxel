import {
  StringField,
  Component,
  field,
  CardDef,
  contains,
} from 'https://cardstack.com/base/card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

import ExternalLink from '@cardstack/boxel-icons/external-link';

export class UrlField extends StringField {
  static icon = ExternalLink;
  static displayName = 'Url';

  static edit = class Edit extends Component<typeof UrlField> {
    get isValidUrl() {
      if (!this.args.model) {
        return false;
      }
      return isValidUrl(this.args.model);
    }
    <template>
      <BoxelInput
        type='url'
        value={{@model}}
        @onInput={{@set}}
        @disabled={{not @canEdit}}
        @state={{if this.isValidUrl 'valid' 'invalid'}}
      />
    </template>
  };

  static atom = class Atom extends Component<typeof UrlField> {
    <template>
      {{#if @model}}
        {{#if (isValidUrl @model)}}
          <a href={{@model}}>{{@model}}</a>
        {{else}}
          Invalid URL
        {{/if}}
      {{/if}}
      <style scoped>
        a:hover {
          text-decoration: underline;
          color: inherit;
        }
      </style>
    </template>
  };
}

function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString);
    return true;
  } catch (err) {
    return false;
  }
}

//TODO: Remove after URL field is implemented
export class CardWithURL extends CardDef {
  static displayName = 'Card with URL';
  @field url = contains(UrlField);
  static isolated = class Isolated extends Component<typeof CardWithURL> {
    <template>
      <@fields.url @format='atom' />
    </template>
  };
}
