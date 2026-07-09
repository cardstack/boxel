import {
  contains,
  field,
  CardDef,
  Component,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import RichMarkdownField from '@cardstack/base/rich-markdown';
import TextIcon from '@cardstack/boxel-icons/text';

export class RichMarkdownPlayground extends CardDef {
  static displayName = 'Rich Markdown Playground';
  static icon = TextIcon;

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
            with its CodeMirror editor. Switch to
            <strong>Edit</strong>
            mode to see the editor, or view the rendered markdown below.
          </p>
        </header>
        <section class='body'>
          <@fields.body />
        </section>
      </article>

      <style scoped>
        .playground {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-xl);
          max-width: 800px;
          margin: 0 auto;
        }
        header h1 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-lg);
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
        .body {
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-border-radius-lg);
          padding: var(--boxel-sp-lg);
          background: white;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='embedded'>
        <h3>{{@model.title}}</h3>
        <@fields.body />
      </div>
      <style scoped>
        .embedded {
          padding: var(--boxel-sp);
        }
        .embedded h3 {
          margin: 0 0 var(--boxel-sp-xs);
        }
      </style>
    </template>
  };
}
