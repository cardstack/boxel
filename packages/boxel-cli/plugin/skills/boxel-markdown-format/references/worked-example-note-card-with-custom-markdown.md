## Worked example: `Note` card with custom markdown

```gts
import { CardDef, field, contains, linksTo, Component } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import MarkdownField from '@cardstack/base/markdown';
import { markdownEscape } from '@cardstack/boxel-ui/helpers';
import { markdownLinkForCard, formatDateTimeForMarkdown } from '@cardstack/base/markdown-helpers';
import { Author } from './author';

export class Note extends CardDef {
  static displayName = 'Note';

  @field cardTitle = contains(StringField);
  @field body = contains(MarkdownField);
  @field author = linksTo(Author);
  @field publishedAt = contains(DateTimeField);

  static markdown = class Markdown extends Component<typeof this> {
    get header() {
      let title = markdownEscape(this.args.model?.cardTitle ?? 'Untitled');
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
