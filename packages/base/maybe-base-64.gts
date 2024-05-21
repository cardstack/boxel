import { Component } from './card-api/-components/utils';
import StringField from './string';

// TODO: This is a simple workaround until the thumbnailURL is converted into an actual image field
export default class MaybeBase64Field extends StringField {
  static embedded = class Embedded extends Component<typeof this> {
    get isBase64() {
      return this.args.model?.startsWith('data:');
    }
    <template>
      {{#if this.isBase64}}
        <em>(Base64 encoded value)</em>
      {{else}}
        {{@model}}
      {{/if}}
    </template>
  };
  static atom = MaybeBase64Field.embedded;
}
