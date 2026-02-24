import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import FileCodeIcon from '@cardstack/boxel-icons/file-code';
import {
  BaseDefComponent,
  Component,
  StringField,
  contains,
  field,
} from './card-api';
import sanitizedHtml from './helpers/sanitized-html';
import {
  FileContentMismatchError,
  FileDef,
  type ByteStream,
  type SerializedFile,
} from './file-api';

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

function truncateExcerpt(text: string): string {
  if (text.length <= EXCERPT_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, EXCERPT_MAX_LENGTH - 3).trimEnd()}...`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function spanWrap(className: string, text: string): string {
  return `<span class="${className}">${escapeHtml(text)}</span>`;
}

// Use RegExp constructor for patterns with < > to avoid content-tag misparsing
const BLOCK_COMMENT_RE = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
const LINE_COMMENT_RE = new RegExp('//[^\n]*', 'g');
const TEMPLATE_TAG_RE = new RegExp('</?template>', 'g');
const STRING_DOUBLE_RE = new RegExp('"(?:[^"\\\\]|\\\\.)*"', 'g');
const STRING_SINGLE_RE = new RegExp("'(?:[^'\\\\]|\\\\.)*'", 'g');
const STRING_TEMPLATE_RE = new RegExp('`(?:[^`\\\\]|\\\\.)*`', 'g');
const DECORATOR_RE = new RegExp('@\\w+', 'g');
const NUMBER_RE = new RegExp('\\b\\d+(?:\\.\\d+)?\\b', 'g');
const KEYWORD_RE = new RegExp(
  '\\b(?:import|export|default|from|class|extends|static|async|await|function|const|let|var|if|else|return|new|this|super|typeof|instanceof|void|null|undefined|true|false|yield|of|in|for|while|do|switch|case|break|continue|try|catch|finally|throw|type|interface|declare|as|implements|readonly|enum|abstract|private|protected|public|get|set)\\b',
  'g',
);
const TYPE_RE = new RegExp('(?:(?::\\s*)|(?:extends\\s+))([A-Z]\\w*)', 'g');

interface Token {
  start: number;
  end: number;
  className: string;
  text: string;
}

function collectMatches(
  source: string,
  regex: RegExp,
  className: string,
  tokens: Token[],
): void {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(source)) !== null) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      className,
      text: match[0],
    });
  }
}

function collectTypeMatches(source: string, tokens: Token[]): void {
  TYPE_RE.lastIndex = 0;
  let match;
  while ((match = TYPE_RE.exec(source)) !== null) {
    let typeName = match[1];
    let typeStart = match.index + match[0].length - typeName.length;
    tokens.push({
      start: typeStart,
      end: typeStart + typeName.length,
      className: 'ts-type',
      text: typeName,
    });
  }
}

export function highlightTs(source: string): string {
  let tokens: Token[] = [];

  // Collect all tokens (order matters for priority — earlier = higher)
  collectMatches(source, BLOCK_COMMENT_RE, 'ts-comment', tokens);
  collectMatches(source, LINE_COMMENT_RE, 'ts-comment', tokens);
  collectMatches(source, STRING_DOUBLE_RE, 'ts-string', tokens);
  collectMatches(source, STRING_SINGLE_RE, 'ts-string', tokens);
  collectMatches(source, STRING_TEMPLATE_RE, 'ts-string', tokens);
  collectMatches(source, TEMPLATE_TAG_RE, 'ts-keyword', tokens);
  collectMatches(source, DECORATOR_RE, 'ts-decorator', tokens);
  collectMatches(source, NUMBER_RE, 'ts-number', tokens);
  collectMatches(source, KEYWORD_RE, 'ts-keyword', tokens);
  collectTypeMatches(source, tokens);

  // Sort by start position, then by priority (earlier collected = higher priority via stable sort)
  tokens.sort((a, b) => a.start - b.start);

  // Remove overlapping tokens (keep the first one encountered)
  let filtered: Token[] = [];
  let lastEnd = 0;
  for (let token of tokens) {
    if (token.start >= lastEnd) {
      filtered.push(token);
      lastEnd = token.end;
    }
  }

  // Build output
  let result = '';
  let pos = 0;
  for (let token of filtered) {
    if (token.start > pos) {
      result += escapeHtml(source.slice(pos, token.start));
    }
    result += spanWrap(token.className, token.text);
    pos = token.end;
  }
  if (pos < source.length) {
    result += escapeHtml(source.slice(pos));
  }
  return result;
}

function tsTitle(
  model: { title?: string | null; name?: string | null } | null | undefined,
): string {
  return model?.title ?? model?.name ?? 'Untitled TypeScript module';
}

class Isolated extends Component<typeof TsFileDef> {
  get highlightedContent() {
    let content = this.args.model?.content;
    if (!content) {
      return null;
    }
    return highlightTs(content);
  }

  get title() {
    return tsTitle(this.args.model);
  }

  <template>
    <article class='ts-isolated' data-test-ts-isolated>
      {{#if this.highlightedContent}}
        <pre class='ts-isolated__code'><code>{{sanitizedHtml
              this.highlightedContent
            }}</code></pre>
      {{else}}
        <header class='ts-isolated__title'>{{this.title}}</header>
      {{/if}}
    </article>
    <style scoped>
      .ts-isolated {
        padding: var(--boxel-sp-lg);
        max-width: 100%;
      }

      .ts-isolated__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-size-lg);
      }

      .ts-isolated__code {
        background: var(--boxel-dark);
        color: var(--boxel-light);
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-sm);
        border-radius: var(--boxel-border-radius-xl);
        padding: var(--boxel-sp-lg);
        overflow-x: auto;
        white-space: pre;
        margin: 0;
        line-height: 1.5;
      }

      .ts-isolated__code :deep(.ts-keyword) {
        color: #569cd6;
      }

      .ts-isolated__code :deep(.ts-string) {
        color: #ce9178;
      }

      .ts-isolated__code :deep(.ts-comment) {
        color: #6a9955;
        font-style: italic;
      }

      .ts-isolated__code :deep(.ts-decorator) {
        color: #dcdcaa;
      }

      .ts-isolated__code :deep(.ts-number) {
        color: #b5cea8;
      }

      .ts-isolated__code :deep(.ts-type) {
        color: #4ec9b0;
      }
    </style>
  </template>
}

class Embedded extends Component<typeof TsFileDef> {
  get title() {
    return tsTitle(this.args.model);
  }

  get codePreview() {
    let content = this.args.model?.content;
    if (!content) {
      return null;
    }
    return highlightTs(content);
  }

  <template>
    <article class='ts-embedded' data-test-ts-embedded>
      <header class='ts-embedded__title'>{{this.title}}</header>
      {{#if this.codePreview}}
        <div class='ts-embedded__preview'>
          <pre class='ts-embedded__code'><code>{{sanitizedHtml
                this.codePreview
              }}</code></pre>
        </div>
      {{/if}}
    </article>
    <style scoped>
      .ts-embedded {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
      }

      .ts-embedded__title {
        color: var(--boxel-900);
        font-weight: 600;
      }

      .ts-embedded__preview {
        max-height: 200px;
        overflow: hidden;
        mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
        -webkit-mask-image: linear-gradient(
          to bottom,
          black 60%,
          transparent 100%
        );
      }

      .ts-embedded__code {
        background: var(--boxel-dark);
        color: var(--boxel-light);
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-xs);
        border-radius: var(--boxel-border-radius-xl);
        padding: var(--boxel-sp);
        margin: 0;
        white-space: pre;
        line-height: 1.4;
      }

      .ts-embedded__code :deep(.ts-keyword) {
        color: #569cd6;
      }

      .ts-embedded__code :deep(.ts-string) {
        color: #ce9178;
      }

      .ts-embedded__code :deep(.ts-comment) {
        color: #6a9955;
        font-style: italic;
      }

      .ts-embedded__code :deep(.ts-decorator) {
        color: #dcdcaa;
      }

      .ts-embedded__code :deep(.ts-number) {
        color: #b5cea8;
      }

      .ts-embedded__code :deep(.ts-type) {
        color: #4ec9b0;
      }
    </style>
  </template>
}

class Fitted extends Component<typeof TsFileDef> {
  get title() {
    return tsTitle(this.args.model);
  }

  get excerpt() {
    return this.args.model?.excerpt ?? '';
  }

  get hasExcerpt() {
    return Boolean(this.excerpt);
  }

  <template>
    <article class='ts-fitted' data-test-ts-fitted>
      <div class='ts-fitted__icon'>
        <FileCodeIcon width='100%' height='100%' />
      </div>
      <div class='ts-fitted__text'>
        <header class='ts-fitted__title'>{{this.title}}</header>
        {{#if this.hasExcerpt}}
          <p class='ts-fitted__excerpt'>{{this.excerpt}}</p>
        {{/if}}
      </div>
    </article>
    <style scoped>
      .ts-fitted {
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

      .ts-fitted__icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        color: var(--boxel-600);
      }

      .ts-fitted__text {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }

      .ts-fitted__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .ts-fitted__excerpt {
        color: var(--boxel-600);
        font-size: var(--boxel-font-xs);
        margin: 0;
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        font-family: var(--boxel-monospace-font-family);
      }

      /* Portrait tall: icon above text */
      @container fitted-card (aspect-ratio <= 1.0) and (height >= 120px) {
        .ts-fitted {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .ts-fitted__icon {
          width: 28px;
          height: 28px;
        }

        .ts-fitted__title {
          -webkit-line-clamp: 3;
        }
      }

      /* Portrait short: hide excerpt */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 120px) {
        .ts-fitted__excerpt {
          display: none;
        }
      }

      /* Portrait very short: hide icon too */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 80px) {
        .ts-fitted__icon {
          display: none;
        }
      }

      /* Landscape: icon left of text */
      @container fitted-card (1.0 < aspect-ratio) {
        .ts-fitted {
          align-items: flex-start;
        }
      }

      /* Landscape short: hide excerpt */
      @container fitted-card (1.0 < aspect-ratio) and (height < 80px) {
        .ts-fitted__excerpt {
          display: none;
        }
      }

      /* Very small: title only, smaller font */
      @container fitted-card (height <= 57px) {
        .ts-fitted__icon {
          display: none;
        }

        .ts-fitted__excerpt {
          display: none;
        }

        .ts-fitted__title {
          font-size: var(--boxel-font-xs);
          -webkit-line-clamp: 1;
        }
      }
    </style>
  </template>
}

class Atom extends Component<typeof TsFileDef> {
  get title() {
    return tsTitle(this.args.model);
  }

  <template>
    <span class='ts-atom' data-test-ts-atom>
      <FileCodeIcon class='ts-atom__icon' width='16' height='16' />
      <span class='ts-atom__title'>{{this.title}}</span>
    </span>
    <style scoped>
      .ts-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }

      .ts-atom__icon {
        flex-shrink: 0;
        color: var(--boxel-600);
      }

      .ts-atom__title {
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

class Head extends Component<typeof TsFileDef> {
  get title() {
    return tsTitle(this.args.model);
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

export class TsFileDef extends FileDef {
  static displayName = 'TypeScript Module';
  static icon = FileCodeIcon;
  static acceptTypes = '.ts';
  static validExtensions = new Set(['.ts']);

  @field title = contains(StringField);
  @field excerpt = contains(StringField);
  @field content = contains(StringField);

  static isolated: BaseDefComponent = Isolated;
  static embedded: BaseDefComponent = Embedded;
  static fitted: BaseDefComponent = Fitted;
  static atom: BaseDefComponent = Atom;
  static head: BaseDefComponent = Head;

  static async extractAttributes(
    this: typeof TsFileDef,
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<
    SerializedFile<{ title: string; excerpt: string; content: string }>
  > {
    let extension = getExtension(url);
    if (!this.validExtensions.has(extension)) {
      throw new FileContentMismatchError(
        `Expected ${[...this.validExtensions].join(' or ')} file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await FileDef.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let source = new TextDecoder().decode(bytes);
    let fallbackTitle = fileNameWithoutExtension(base.name ?? '');

    return {
      ...base,
      title: fallbackTitle,
      excerpt: truncateExcerpt(source.replace(/\s+/g, ' ').trim()),
      content: source,
    };
  }
}
