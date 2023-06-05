import { primitive, Component, CardBase, useIndexBasedKey } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { marked } from 'marked';
import { sanitizeHtml } from '@cardstack/runtime-common';

function toHtml(markdown: string | null) {
  return markdown ? sanitizeHtml(marked(markdown)) : '';
}

export default class MarkdownCard extends CardBase {
  static [primitive]: string;
  static [useIndexBasedKey]: never;

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div>
        {{{toHtml @model}}}
      </div>
    </template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div>
        {{{toHtml @model}}}
      </div>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput 
        class='boxel-text-area' 
        @multiline={{true}} 
        @value={{@model}} 
        @onInput={{@set}} />
    </template>
  };
}
