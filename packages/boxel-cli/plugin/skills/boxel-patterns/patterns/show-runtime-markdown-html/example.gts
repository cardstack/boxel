import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import DateTimeField from 'https://cardstack.com/base/datetime';

// 🧩 PATTERN: Render BFM/markdown to HTML at runtime.
//
// MarkdownField's default render handles BFM directives, mermaid, math,
// alerts, footnotes, code highlighting, etc. <@fields.body /> is all you need.

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';

  @field cardTitle   = contains(StringField);
  @field publishedAt = contains(DateTimeField);
  @field body        = contains(MarkdownField);

  static isolated = class extends Component<typeof BlogPost> {
    <template>
      <article class='post'>
        <header>
          <h1>{{@model.cardTitle}}</h1>
          {{#if @model.publishedAt}}
            <time>{{@model.publishedAt}}</time>
          {{/if}}
        </header>

        <main class='post-body'>
          {{!--
            🎯 The full rendering path. MarkdownField:
              - Parses BFM (CommonMark + GFM + Boxel extensions)
              - Sanitizes HTML
              - Renders mermaid fences
              - Resolves :card[<url>] and ::card[<url>] embeds
              - Lazy-loads math (KaTeX) and code highlighting (Monaco)
          --}}
          <@fields.body />
        </main>
      </article>

      <style scoped>
        .post { max-width: 720px; margin: 0 auto; padding: 2rem; }
        .post header { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border, #e6e6e6); }
        .post h1 { margin: 0 0 0.5rem; }
        .post time { color: var(--muted-foreground, #666); font-size: 0.85rem; }
        .post-body { line-height: 1.6; }
      </style>
    </template>
  };

  static embedded = class extends Component<typeof BlogPost> {
    <template>
      <article class='post-preview'>
        <h2>{{@model.cardTitle}}</h2>
        {{!--
          For embedded view, you typically want a shorter rendering.
          One option: render just a derived excerpt field.
          Another: use the same <@fields.body /> but clip with CSS.
        --}}
        <div class='excerpt'>
          <@fields.body />
        </div>
      </article>

      <style scoped>
        .post-preview { padding: 1rem; border: 1px solid var(--border, #e6e6e6); border-radius: var(--radius, 8px); }
        .post-preview h2 { margin: 0 0 0.5rem; }
        .excerpt {
          max-height: 8em;
          overflow: hidden;
          mask-image: linear-gradient(to bottom, black 60%, transparent);
        }
      </style>
    </template>
  };
}
