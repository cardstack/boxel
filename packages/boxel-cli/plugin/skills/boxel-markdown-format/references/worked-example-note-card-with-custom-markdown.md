## Worked example: `Note` card with custom markdown

```gts
import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { markdownEscape } from '@cardstack/boxel-ui/helpers';
import {
  markdownLinkForCard,
  formatDateTimeForMarkdown,
} from 'https://cardstack.com/base/markdown-helpers';
import { Author } from './author';

export class Note extends CardDef {
  static displayName = 'Note';

  @field title = contains(StringField);
  @field body = contains(MarkdownField);
  @field author = linksTo(Author);
  @field publishedAt = contains(DateTimeField);

  static markdown = class Markdown extends Component<typeof this> {
    get header() {
      let title = markdownEscape(this.args.model?.title ?? 'Untitled');
      let byline = this.args.model?.author
        ? `By ${markdownLinkForCard(this.args.model.author)}`
        : '';
      let when = formatDateTimeForMarkdown(this.args.model?.publishedAt);
      let meta = [byline, when].filter(Boolean).join(' · ');
      return meta ? `# ${title}\n\n${meta}` : `# ${title}`;
    }
    <template>
      {{!-- prettier-ignore --}}
      {{this.header}}

      <@fields.body />
    </template>
  };
}
```
