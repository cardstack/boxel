import { Component, StringField } from './card-api';

export default class CSSValueField extends StringField {
  static displayName = 'CSS Value';
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <code>{{if @model @model '/* not set */'}}</code>
      <style scoped>
        @layer baseComponent {
          code {
            font-family: var(
              --font-mono,
              var(--boxel-monospace-font-family, monospace)
            );
          }
        }
      </style>
    </template>
  };
}
