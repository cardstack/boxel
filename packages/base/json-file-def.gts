import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import JsonIcon from '@cardstack/boxel-icons/json';
import {
  BaseDefComponent,
  Component,
  StringField,
  contains,
  field,
} from './card-api';
import {
  FileContentMismatchError,
  FileDef,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import sanitizedHtml from './helpers/sanitized-html';

const EXCERPT_MAX_LENGTH = 500;

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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

function jsonTitle(
  model: { title?: string | null; name?: string | null } | null | undefined,
): string {
  return model?.title ?? model?.name ?? 'Untitled JSON';
}

function prettyPrintJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function highlightJson(json: string): string {
  let escaped = escapeHtml(json);
  // Highlight keys (property names before colon)
  escaped = escaped.replace(
    /(&quot;)((?:[^&]|&(?!quot;))*)(&quot;)\s*:/g,
    '<span class="json-key">$1$2$3</span>:',
  );
  // Highlight string values (quoted strings not followed by colon)
  escaped = escaped.replace(
    /(&quot;)((?:[^&]|&(?!quot;))*)(&quot;)(?!\s*:)/g,
    '<span class="json-string">$1$2$3</span>',
  );
  // Highlight numbers
  escaped = escaped.replace(
    /\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g,
    '<span class="json-number">$1</span>',
  );
  // Highlight booleans
  escaped = escaped.replace(
    /\b(true|false)\b/g,
    '<span class="json-boolean">$1</span>',
  );
  // Highlight null
  escaped = escaped.replace(
    /\bnull\b/g,
    '<span class="json-null">null</span>',
  );
  return escaped;
}

class Isolated extends Component<typeof JsonFileDef> {
  get title() {
    return jsonTitle(this.args.model);
  }

  get highlightedContent() {
    let content = this.args.model?.content ?? '';
    if (!content.trim()) {
      return '';
    }
    return highlightJson(prettyPrintJson(content));
  }

  get hasContent() {
    return Boolean(this.args.model?.content?.trim());
  }

  <template>
    <article class='json-isolated' data-test-json-isolated>
      {{#if this.hasContent}}
        <pre class='json-isolated__content'>{{sanitizedHtml
            this.highlightedContent
          }}</pre>
      {{else}}
        <header class='json-isolated__title'>{{this.title}}</header>
      {{/if}}
    </article>
    <style scoped>
      .json-isolated {
        padding: var(--boxel-sp-lg);
        max-width: 100%;
      }

      .json-isolated__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-size-lg);
      }

      .json-isolated__content {
        font-family: var(--boxel-monospace-font-family, monospace);
        white-space: pre-wrap;
        word-wrap: break-word;
        margin: 0;
        font-size: var(--boxel-font-sm);
        line-height: 1.5;
        background-color: var(--boxel-dark);
        color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        padding: var(--boxel-sp-lg);
      }

      .json-isolated__content :deep(.json-key) {
        color: #9cdcfe;
      }

      .json-isolated__content :deep(.json-string) {
        color: #ce9178;
      }

      .json-isolated__content :deep(.json-number) {
        color: #b5cea8;
      }

      .json-isolated__content :deep(.json-boolean) {
        color: #569cd6;
      }

      .json-isolated__content :deep(.json-null) {
        color: #569cd6;
      }
    </style>
  </template>
}

class Embedded extends Component<typeof JsonFileDef> {
  get title() {
    return jsonTitle(this.args.model);
  }

  get highlightedContent() {
    let content = this.args.model?.content ?? '';
    if (!content.trim()) {
      return '';
    }
    return highlightJson(prettyPrintJson(content));
  }

  <template>
    <article class='json-embedded' data-test-json-embedded>
      <header class='json-embedded__title'>{{this.title}}</header>
      <div class='json-embedded__content'>
        <pre class='json-embedded__pre'>{{sanitizedHtml
            this.highlightedContent
          }}</pre>
      </div>
    </article>
    <style scoped>
      .json-embedded {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
      }

      .json-embedded__title {
        color: var(--boxel-900);
        font-weight: 600;
      }

      .json-embedded__content {
        max-height: 200px;
        overflow: hidden;
        mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
        -webkit-mask-image: linear-gradient(
          to bottom,
          black 60%,
          transparent 100%
        );
      }

      .json-embedded__pre {
        font-family: var(--boxel-monospace-font-family, monospace);
        white-space: pre-wrap;
        word-wrap: break-word;
        margin: 0;
        font-size: var(--boxel-font-sm);
        line-height: 1.5;
        background-color: var(--boxel-dark);
        color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        padding: var(--boxel-sp-lg);
      }

      .json-embedded__pre :deep(.json-key) {
        color: #9cdcfe;
      }

      .json-embedded__pre :deep(.json-string) {
        color: #ce9178;
      }

      .json-embedded__pre :deep(.json-number) {
        color: #b5cea8;
      }

      .json-embedded__pre :deep(.json-boolean) {
        color: #569cd6;
      }

      .json-embedded__pre :deep(.json-null) {
        color: #569cd6;
      }
    </style>
  </template>
}

class Fitted extends Component<typeof JsonFileDef> {
  get title() {
    return jsonTitle(this.args.model);
  }

  get excerpt() {
    return this.args.model?.excerpt ?? '';
  }

  get hasExcerpt() {
    return Boolean(this.excerpt);
  }

  <template>
    <article class='json-fitted' data-test-json-fitted>
      <div class='json-fitted__icon'>
        <JsonIcon width='100%' height='100%' />
      </div>
      <div class='json-fitted__text'>
        <header class='json-fitted__title'>{{this.title}}</header>
        {{#if this.hasExcerpt}}
          <p class='json-fitted__excerpt'>{{this.excerpt}}</p>
        {{/if}}
      </div>
    </article>
    <style scoped>
      .json-fitted {
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

      .json-fitted__icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        color: var(--boxel-600);
      }

      .json-fitted__text {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }

      .json-fitted__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .json-fitted__excerpt {
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
        .json-fitted {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .json-fitted__icon {
          width: 28px;
          height: 28px;
        }

        .json-fitted__title {
          -webkit-line-clamp: 3;
        }
      }

      /* Portrait short: hide excerpt */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 120px) {
        .json-fitted__excerpt {
          display: none;
        }
      }

      /* Portrait very short: hide icon too */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 80px) {
        .json-fitted__icon {
          display: none;
        }
      }

      /* Landscape: icon left of text */
      @container fitted-card (1.0 < aspect-ratio) {
        .json-fitted {
          align-items: flex-start;
        }
      }

      /* Landscape short: hide excerpt */
      @container fitted-card (1.0 < aspect-ratio) and (height < 80px) {
        .json-fitted__excerpt {
          display: none;
        }
      }

      /* Very small: title only, smaller font */
      @container fitted-card (height <= 57px) {
        .json-fitted__icon {
          display: none;
        }

        .json-fitted__excerpt {
          display: none;
        }

        .json-fitted__title {
          font-size: var(--boxel-font-xs);
          -webkit-line-clamp: 1;
        }
      }
    </style>
  </template>
}

class Atom extends Component<typeof JsonFileDef> {
  get title() {
    return jsonTitle(this.args.model);
  }

  <template>
    <span class='json-atom' data-test-json-atom>
      <JsonIcon class='json-atom__icon' width='16' height='16' />
      <span class='json-atom__title'>{{this.title}}</span>
    </span>
    <style scoped>
      .json-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }

      .json-atom__icon {
        flex-shrink: 0;
        color: var(--boxel-600);
      }

      .json-atom__title {
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

class Head extends Component<typeof JsonFileDef> {
  get title() {
    return jsonTitle(this.args.model);
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

export class JsonFileDef extends FileDef {
  static displayName = 'JSON';
  static icon = JsonIcon;
  static acceptTypes = '.json,application/json';

  @field title = contains(StringField);
  @field excerpt = contains(StringField);
  @field content = contains(StringField);

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
    SerializedFile<{ title: string; excerpt: string; content: string }>
  > {
    let extension = getExtension(url);
    if (extension !== '.json') {
      throw new FileContentMismatchError(
        `Expected .json file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let text = new TextDecoder().decode(bytes);
    let fallbackTitle = fileNameWithoutExtension(base.name ?? '');

    return {
      ...base,
      title: fallbackTitle || 'Untitled JSON',
      excerpt: truncateExcerpt(text.trim()),
      content: text,
    };
  }
}
