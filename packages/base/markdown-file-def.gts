import {
  byteStreamToUint8Array,
  extractCardReferenceUrls,
} from '@cardstack/runtime-common';
import MarkdownIcon from '@cardstack/boxel-icons/align-box-left-middle';
import {
  BaseDefComponent,
  CardDef,
  Component,
  StringField,
  contains,
  containsMany,
  field,
  linksToMany,
} from './card-api';
import MarkdownTemplate from './default-templates/markdown';
import {
  FileContentMismatchError,
  FileDef,
  type ByteStream,
  type SerializedFile,
} from './file-api';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const EXCERPT_MAX_LENGTH = 500;

function getExtension(url: string): string {
  try {
    let parsed = new URL(url);
    let name = parsed.pathname.split('/').pop() ?? '';
    let dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot).toLowerCase();
  } catch {
    let dot = url.lastIndexOf('.');
    return dot === -1 ? '' : url.slice(dot).toLowerCase();
  }
}

function fileNameWithoutExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// content-tag misparses backticks inside regex literals in .gts files
const FENCED_CODE_RE = new RegExp('```[\\s\\S]*?```', 'g');
const INLINE_CODE_RE = new RegExp('`([^`]+)`', 'g');

function stripMarkdown(text: string): string {
  return text
    .replace(FENCED_CODE_RE, '')
    .replace(INLINE_CODE_RE, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateExcerpt(text: string): string {
  if (text.length <= EXCERPT_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, EXCERPT_MAX_LENGTH - 3).trimEnd()}...`;
}

function extractTitle(markdown: string, fallback: string): string {
  let normalized = normalizeMarkdown(markdown);
  for (let line of normalized.split('\n')) {
    let match = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match?.[1]) {
      let title = stripMarkdown(match[1]);
      if (title) {
        return title;
      }
    }
  }
  return fallback;
}

const HEADING_RE = /^\s*#{1,6}\s+/;

function extractExcerpt(markdown: string): string {
  let normalized = normalizeMarkdown(markdown);
  let paragraphs = normalized.split(/\n\s*\n/);
  for (let paragraph of paragraphs) {
    let trimmed = paragraph.trim();
    if (!trimmed) {
      continue;
    }
    let lines = trimmed.split('\n');
    let hasNonHeading = lines.some((line) => !HEADING_RE.test(line));
    if (!hasNonHeading) {
      continue;
    }
    let withoutHeadings = lines
      .filter((line) => !HEADING_RE.test(line))
      .join(' ');
    let excerpt = stripMarkdown(withoutHeadings);
    if (excerpt) {
      return truncateExcerpt(excerpt);
    }
  }
  return '';
}

function markdownTitle(
  model: { title?: string | null; name?: string | null } | null | undefined,
): string {
  return model?.title ?? model?.name ?? 'Untitled markdown';
}

class Isolated extends Component<typeof MarkdownDef> {
  get title() {
    return markdownTitle(this.args.model);
  }

  get content() {
    return this.args.model?.content ?? null;
  }

  get hasContent() {
    return Boolean(this.args.model?.content?.trim());
  }

  <template>
    <article class='markdown-isolated' data-test-markdown-isolated>
      {{#if this.hasContent}}
        <MarkdownTemplate
          @content={{this.content}}
          @linkedCards={{@model.linkedCards}}
          @cardReferenceBaseUrl={{@model.id}}
        />
      {{else}}
        <header class='markdown-isolated__title'>{{this.title}}</header>
      {{/if}}
    </article>
    <style scoped>
      .markdown-isolated {
        padding: var(--boxel-sp-lg);
        max-width: 100%;
      }

      .markdown-isolated__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-size-lg);
      }

      .markdown-isolated :deep(h1:first-child),
      .markdown-isolated :deep(h2:first-child),
      .markdown-isolated :deep(h3:first-child),
      .markdown-isolated :deep(h4:first-child),
      .markdown-isolated :deep(h5:first-child),
      .markdown-isolated :deep(h6:first-child) {
        margin-top: 0;
      }
    </style>
  </template>
}

class Embedded extends Component<typeof MarkdownDef> {
  get title() {
    return markdownTitle(this.args.model);
  }

  get content() {
    return this.args.model?.content ?? null;
  }

  get contentStartsWithTitle() {
    let content = this.args.model?.content?.trim();
    if (!content) {
      return false;
    }
    let firstLine = content.split('\n')[0].trim();
    let match = firstLine.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match?.[1]) {
      return false;
    }
    let headingText = stripMarkdown(match[1]);
    return headingText === this.title;
  }

  <template>
    <article class='markdown-embedded' data-test-markdown-embedded>
      {{#unless this.contentStartsWithTitle}}
        <header class='markdown-embedded__title'>{{this.title}}</header>
      {{/unless}}
      <div class='markdown-embedded__content'>
        <MarkdownTemplate
          @content={{this.content}}
          @linkedCards={{@model.linkedCards}}
          @cardReferenceBaseUrl={{@model.id}}
        />
      </div>
    </article>
    <style scoped>
      .markdown-embedded {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
      }

      .markdown-embedded__title {
        color: var(--boxel-900);
        font-weight: 600;
      }

      .markdown-embedded__content {
        max-height: 200px;
        overflow: hidden;
        mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
        -webkit-mask-image: linear-gradient(
          to bottom,
          black 60%,
          transparent 100%
        );
      }

      .markdown-embedded__content :deep(h1:first-child),
      .markdown-embedded__content :deep(h2:first-child),
      .markdown-embedded__content :deep(h3:first-child),
      .markdown-embedded__content :deep(h4:first-child),
      .markdown-embedded__content :deep(h5:first-child),
      .markdown-embedded__content :deep(h6:first-child) {
        margin-top: 0;
      }
    </style>
  </template>
}

class Fitted extends Component<typeof MarkdownDef> {
  get title() {
    return markdownTitle(this.args.model);
  }

  get excerpt() {
    return this.args.model?.excerpt ?? '';
  }

  get hasExcerpt() {
    return Boolean(this.excerpt);
  }

  <template>
    <article class='markdown-fitted' data-test-markdown-fitted>
      <div class='markdown-fitted__icon'>
        <MarkdownIcon width='100%' height='100%' />
      </div>
      <div class='markdown-fitted__text'>
        <header class='markdown-fitted__title'>{{this.title}}</header>
        {{#if this.hasExcerpt}}
          <p class='markdown-fitted__excerpt'>{{this.excerpt}}</p>
        {{/if}}
      </div>
    </article>
    <style scoped>
      .markdown-fitted {
        container-name: fitted-card;
        container-type: size;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        overflow: hidden;
      }

      .markdown-fitted__icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        color: var(--boxel-600);
      }

      .markdown-fitted__text {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }

      .markdown-fitted__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .markdown-fitted__excerpt {
        color: var(--boxel-600);
        font-size: var(--boxel-font-xs);
        margin: 0;
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }

      /* Portrait tall: icon above text */
      @container fitted-card (aspect-ratio <= 1.0) and (height >= 120px) {
        .markdown-fitted {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .markdown-fitted__icon {
          width: 28px;
          height: 28px;
        }

        .markdown-fitted__title {
          -webkit-line-clamp: 3;
        }
      }

      /* Portrait short: hide excerpt */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 120px) {
        .markdown-fitted__excerpt {
          display: none;
        }
      }

      /* Portrait very short: hide icon too */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 80px) {
        .markdown-fitted__icon {
          display: none;
        }
      }

      /* Landscape: icon left of text */
      @container fitted-card (1.0 < aspect-ratio) {
        .markdown-fitted {
          align-items: flex-start;
        }
      }

      /* Landscape short: hide excerpt */
      @container fitted-card (1.0 < aspect-ratio) and (height < 80px) {
        .markdown-fitted__excerpt {
          display: none;
        }
      }

      /* Very small: title only, smaller font */
      @container fitted-card (height <= 57px) {
        .markdown-fitted__icon {
          display: none;
        }

        .markdown-fitted__excerpt {
          display: none;
        }

        .markdown-fitted__title {
          font-size: var(--boxel-font-xs);
          -webkit-line-clamp: 1;
        }
      }
    </style>
  </template>
}

class Atom extends Component<typeof MarkdownDef> {
  get title() {
    return markdownTitle(this.args.model);
  }

  <template>
    <span class='markdown-atom' data-test-markdown-atom>
      <MarkdownIcon class='markdown-atom__icon' width='16' height='16' />
      <span class='markdown-atom__title'>{{this.title}}</span>
    </span>
    <style scoped>
      .markdown-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }

      .markdown-atom__icon {
        flex-shrink: 0;
        color: var(--boxel-600);
      }

      .markdown-atom__title {
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

class Head extends Component<typeof MarkdownDef> {
  get title() {
    return markdownTitle(this.args.model);
  }

  get description() {
    return this.args.model?.excerpt;
  }

  <template>
    {{! template-lint-disable no-forbidden-elements }}
    <title data-test-card-head-title>{{this.title}}</title>

    <meta property='og:title' content={{this.title}} />
    <meta name='twitter:title' content={{this.title}} />
    <meta property='og:url' content={{@model.id}} />

    {{#if this.description}}
      <meta name='description' content={{this.description}} />
      <meta property='og:description' content={{this.description}} />
      <meta name='twitter:description' content={{this.description}} />
    {{/if}}

    <meta name='twitter:card' content='summary' />
    <meta property='og:type' content='article' />
  </template>
}

export class MarkdownDef extends FileDef {
  static displayName = 'Markdown';
  static acceptTypes = '.md,.markdown';

  @field title = contains(StringField);
  @field excerpt = contains(StringField);
  @field content = contains(StringField);

  @field cardReferenceUrls = containsMany(StringField, {
    computeVia: function (this: MarkdownDef) {
      if (!this.content) {
        return [];
      }
      return extractCardReferenceUrls(this.content, this.id ?? '');
    },
  });

  @field linkedCards = linksToMany(CardDef, {
    query: {
      filter: {
        in: { id: '$this.cardReferenceUrls' },
      },
    },
  });

  static isolated: BaseDefComponent = Isolated;
  static embedded: BaseDefComponent = Embedded;
  static fitted: BaseDefComponent = Fitted;
  static atom: BaseDefComponent = Atom;
  static head: BaseDefComponent = Head;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<
    SerializedFile<{
      title: string;
      excerpt: string;
      content: string;
      cardReferenceUrls: string[];
    }>
  > {
    let extension = getExtension(url);
    if (!MARKDOWN_EXTENSIONS.has(extension)) {
      throw new FileContentMismatchError(
        `Expected markdown file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let markdown = new TextDecoder().decode(bytes);
    let fallbackTitle = fileNameWithoutExtension(base.name ?? '');

    return {
      ...base,
      title: extractTitle(markdown, fallbackTitle),
      excerpt: extractExcerpt(markdown),
      content: markdown,
      cardReferenceUrls: extractCardReferenceUrls(markdown, url),
    };
  }
}
