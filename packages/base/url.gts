import { StringField, Component, field, CardDef, contains } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

import ExternalLink from '@cardstack/boxel-icons/external-link';

export default class UrlField extends StringField {
  static icon = ExternalLink;
  static displayName = 'Url';

  static edit = class Edit extends Component<typeof UrlField> {
    get validationState() {
      if (!this.args.model) {
        // do not error before any input
        return;
      }
      return isValidUrl(this.args.model) ? 'valid' : 'invalid';
    }
    <template>
      <BoxelInput
        type='url'
        value={{@model}}
        @onInput={{@set}}
        @disabled={{not @canEdit}}
        @state={{this.validationState}}
      />
    </template>
  };

  static atom = class Atom extends Component<typeof UrlField> {
    <template>
      {{#if @model}}
        {{#if (isValidUrl @model)}}
          <a href={{@model}} target='_blank' rel='noopener noreferrer'>
            {{@model}}
          </a>
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
