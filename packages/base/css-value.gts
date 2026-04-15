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

  // CS-10787: render CSS values inside inline code delimiters so they're
  // clearly identifiable as literal values. Wraps in a backtick fence wide
  // enough to contain any backticks in the value.
  static markdown = class Markdown extends Component<typeof CSSValueField> {
    get text() {
      let value = this.args.model;
      if (!value) {
        return '';
      }
      let longestRun = 0;
      let match = value.match(/`+/g);
      if (match) {
        for (let run of match) {
          if (run.length > longestRun) longestRun = run.length;
        }
      }
      let fence = '`'.repeat(Math.max(1, longestRun + 1));
      let needsPad =
        value.startsWith('`') || value.endsWith('`') || /^\s|\s$/.test(value);
      return needsPad ? `${fence} ${value} ${fence}` : `${fence}${value}${fence}`;
    }
    <template>{{this.text}}</template>
  };
}
