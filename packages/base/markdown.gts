import { primitive, Component, useIndexBasedKey, FieldDef } from './card-api';
import { BoxelInput } from '@cardstack/boxel-ui';
import { marked } from 'marked';
import { sanitizeHtml } from '@cardstack/runtime-common';

const markdownOpts = {
  mangle: false,
  headerIds: false,
};

function toHtml(markdown: string | null) {
  return markdown ? sanitizeHtml(marked(markdown, markdownOpts)) : '';
}

class View extends Component<typeof MarkdownField> {
  <template>
    <div>
      {{{toHtml @model}}}
    </div>
  </template>
}

export default class MarkdownField extends FieldDef {
  static displayName = 'Markdown';
  static [primitive]: string;
  static [useIndexBasedKey]: never;

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div>
        {{{toHtml @model}}}
      </div>
    </template>
  };

  static embedded = View;
  static atom = View;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        class='boxel-text-area'
        @multiline={{true}}
        @value={{@model}}
        @onInput={{@set}}
      />
    </template>
  };
}
