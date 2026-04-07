import {
  contains,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { RichMarkdownField } from 'https://cardstack.com/base/rich-markdown';

export class RichMarkdownPlayground extends CardDef {
  static displayName = 'Rich Markdown Playground';

  @field title = contains(StringField);
  @field body = contains(RichMarkdownField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='playground'>
        <header>
          <h1>{{@model.title}}</h1>
          <p class='subtitle'>
            This playground exercises the
            <code>RichMarkdownField</code>
            with its ProseMirror WYSIWYG editor. Switch to
            <strong>Edit</strong>
            mode to see the editor, or view the rendered markdown below.
          </p>
        </header>

        <section class='content'>
          <h2>Content</h2>
          <div class='rendered-markdown'>
            <@fields.body />
          </div>
        </section>
      </article>

      <style scoped>
        .playground {
          max-width: 800px;
          margin: 0 auto;
          padding: var(--boxel-sp-lg, 24px);
          font-family: var(--boxel-font-family, sans-serif);
        }

        .playground header {
          margin-bottom: var(--boxel-sp-lg, 24px);
          padding-bottom: var(--boxel-sp, 16px);
          border-bottom: 1px solid var(--boxel-border-color, #e0e0e0);
        }

        .playground h1 {
          margin: 0 0 var(--boxel-sp-xs, 4px);
          font-size: 1.75rem;
          font-weight: 700;
        }

        .subtitle {
          color: var(--boxel-400, #666);
          margin: 0;
          line-height: 1.5;
        }

        .subtitle code {
          background: var(--boxel-100, #f5f5f5);
          padding: 0.1em 0.4em;
          border-radius: 3px;
          font-size: 0.9em;
        }

        .content h2 {
          font-size: 1.1rem;
          font-weight: 600;
          margin-bottom: var(--boxel-sp-sm, 8px);
          color: var(--boxel-400, #666);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .rendered-markdown {
          border: 1px solid var(--boxel-border-color, #e0e0e0);
          border-radius: var(--boxel-border-radius, 4px);
          padding: var(--boxel-sp, 16px);
          min-height: 200px;
        }
      </style>
    </template>
  };
}
