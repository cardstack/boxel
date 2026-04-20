import { Component, primitive, FieldDef } from './card-api';
import { markdownEscape } from '@cardstack/boxel-ui/helpers';

export default class ResponseField extends FieldDef {
  static displayName = 'Response';
  static [primitive]: Response;

  // CS-10787: emit a short placeholder describing the HTTP response. The raw
  // Response object isn't markdown-representable, so we summarize by status
  // line when present and emit nothing otherwise.
  static markdown = class Markdown extends Component<typeof ResponseField> {
    get text() {
      let model = this.args.model;
      if (!model) {
        return '';
      }
      let status = typeof model.status === 'number' ? model.status : undefined;
      let statusText = typeof model.statusText === 'string'
        ? model.statusText
        : '';
      if (status == null) {
        return '[HTTP response]';
      }
      let summary = statusText
        ? `${status} ${statusText}`
        : String(status);
      return `[HTTP response: ${markdownEscape(summary)}]`;
    }
    <template>{{this.text}}</template>
  };
}
