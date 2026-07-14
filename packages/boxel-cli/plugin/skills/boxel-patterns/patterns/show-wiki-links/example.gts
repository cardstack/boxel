// Pattern example: wiki links inside rendered MarkdownField content.
import { modifier } from 'ember-modifier';
import { on } from '@ember/modifier';
import {
  CardDef,
  Component,
  contains,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import StringField from 'https://cardstack.com/base/string';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractWikiLinks(markdown: string): string[] {
  let links: string[] = [];
  let seen = new Set<string>();
  let regex = /\[\[([^\]]+)\]\]/g;
  let match;

  while ((match = regex.exec(markdown)) !== null) {
    let name = match[1].trim();
    let key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      links.push(name);
    }
  }

  return links;
}

const processWikiLinks = modifier((element: HTMLElement) => {
  let html = element.innerHTML;
  let replaced = html.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match: string, rawName: string) => {
      let name = rawName.trim();
      let slug = slugify(name);
      return `<a class="wiki-link" data-wiki-name="${escapeHtml(
        name,
      )}" data-wiki-slug="${escapeHtml(slug)}" href="#wiki:${escapeHtml(
        slug,
      )}">${escapeHtml(name)}</a>`;
    },
  );

  if (html !== replaced) {
    element.innerHTML = replaced;
  }
});

export class WikiPage extends CardDef {
  static displayName = 'Wiki Page';
  static prefersWideFormat = true;

  @field content = contains(MarkdownField);
  @field tags = contains(StringField);
  @field relatedPages = linksToMany(() => WikiPage);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: WikiPage) {
      return this.cardInfo?.name ?? this.cardInfo?.title ?? 'Untitled Page';
    },
  });

  static isolated = class Isolated extends Component<typeof WikiPage> {
    get outgoingWikiLinks() {
      return extractWikiLinks(this.args.model.content ?? '');
    }

    handleContentClick = (event: MouseEvent) => {
      let target = event.target as HTMLElement | null;
      let link = target?.closest?.('.wiki-link') as HTMLElement | null;
      if (!link) {
        return;
      }

      event.preventDefault();
      let wantedName = link.getAttribute('data-wiki-name') ?? '';
      let wantedSlug = link.getAttribute('data-wiki-slug') ?? '';
      let match = this.args.model.relatedPages?.find((page) => {
        let title = page.cardTitle ?? '';
        return (
          title.toLowerCase() === wantedName.toLowerCase() ||
          slugify(title) === wantedSlug
        );
      });

      if (match) {
        this.args.viewCard(match, 'isolated');
      }
    };

    <template>
      <div class='wiki-layout'>
        <aside>
          <h2>Linked Pages</h2>
          <ul>
            {{#each this.outgoingWikiLinks as |name|}}
              <li>{{name}}</li>
            {{/each}}
          </ul>
        </aside>

        <article
          class='wiki-content'
          {{processWikiLinks}}
          {{on 'click' this.handleContentClick}}
        >
          <@fields.content />
        </article>
      </div>

      <style scoped>
        .wiki-layout {
          display: grid;
          grid-template-columns: 14rem minmax(0, 1fr);
          gap: 1.25rem;
          height: 100%;
          padding: 1rem;
          background: var(--background, #fff);
          color: var(--foreground, #17202a);
        }

        aside {
          border-right: 1px solid var(--border, #d8dee7);
          padding-right: 1rem;
        }

        .wiki-content :deep(.wiki-link) {
          color: var(--primary, #285de8);
          font-weight: 650;
          text-decoration: underline;
          cursor: pointer;
        }
      </style>
    </template>
  };
}
