import { not } from '@cardstack/boxel-ui/helpers';
import { Component } from './card-api';
import StringField from './string';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { markdownToHtml } from '@cardstack/runtime-common';
import AlignBoxLeftMiddleIcon from '@cardstack/boxel-icons/align-box-left-middle';

class View extends Component<typeof MarkdownField> {
  <template>
    <div>
      {{! template-lint-disable no-triple-curlies }}
      {{{markdownToHtml @model}}}
    </div>
  </template>
}

export default class MarkdownField extends StringField {
  static displayName = 'Markdown';
  static icon = AlignBoxLeftMiddleIcon;

  static embedded = View;
  static atom = View;

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        class='boxel-text-area'
        @type='textarea'
        @value={{@model}}
        @onInput={{@set}}
        @disabled={{not @canEdit}}
      />
    </template>
  };
}
