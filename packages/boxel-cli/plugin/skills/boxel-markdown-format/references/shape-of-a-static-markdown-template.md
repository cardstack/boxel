## Shape of a `static markdown` template

It's a format slot like `static isolated`, but emits **plain text**, not HTML. Glimmer HTML-escapes the string in the DOM; the prerender pipeline decodes those entities when it captures `textContent`, so the markdown parser downstream sees the literal characters you emitted.

```gts
import { CardDef, Component } from 'https://cardstack.com/base/card-api';
import { markdownEscape } from '@cardstack/boxel-ui/helpers';

export class Note extends CardDef {
  static displayName = 'Note';

  static markdown = class Markdown extends Component<typeof this> {
    get text() {
      return markdownEscape(this.args.model?.title ?? '');
    }
    <template>{{this.text}}</template>
  };
}
```

Rules of thumb:

- The template should emit **only text** — no layout elements, no `<style>`, no `{{! comments }}` that leak.
- Return `''` for null/empty — never emit the string `"undefined"` or `"null"`.
- Whitespace is preserved (the render container applies `white-space: pre`), so newlines and indentation you emit survive into the output.
