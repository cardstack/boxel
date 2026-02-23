import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import TextFileIcon from '@cardstack/boxel-icons/file-text';
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

const TEXT_EXTENSIONS = new Set(['.txt', '.text']);
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

function textTitle(
  model: { title?: string | null; name?: string | null } | null | undefined,
): string {
  return model?.title ?? model?.name ?? 'Untitled text file';
}

class Isolated extends Component<typeof TextFileDef> {
  get title() {
    return textTitle(this.args.model);
  }

  get content() {
    return this.args.model?.content ?? '';
  }

  get hasContent() {
    return Boolean(this.args.model?.content?.trim());
  }

  <template>
    <article class='text-isolated' data-test-text-isolated>
      {{#if this.hasContent}}
        <pre class='text-isolated__content'>{{this.content}}</pre>
      {{else}}
        <header class='text-isolated__title'>{{this.title}}</header>
      {{/if}}
    </article>
    <style scoped>
      .text-isolated {
        padding: var(--boxel-sp-lg);
        max-width: 100%;
      }

      .text-isolated__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-size-lg);
      }

      .text-isolated__content {
        font-family: monospace;
        white-space: pre-wrap;
        word-wrap: break-word;
        margin: 0;
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        line-height: 1.5;
      }
    </style>
  </template>
}

class Embedded extends Component<typeof TextFileDef> {
  get title() {
    return textTitle(this.args.model);
  }

  get content() {
    return this.args.model?.content ?? '';
  }

  <template>
    <article class='text-embedded' data-test-text-embedded>
      <header class='text-embedded__title'>{{this.title}}</header>
      <div class='text-embedded__content'>
        <pre class='text-embedded__pre'>{{this.content}}</pre>
      </div>
    </article>
    <style scoped>
      .text-embedded {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
      }

      .text-embedded__title {
        color: var(--boxel-900);
        font-weight: 600;
      }

      .text-embedded__content {
        max-height: 200px;
        overflow: hidden;
        mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
        -webkit-mask-image: linear-gradient(
          to bottom,
          black 60%,
          transparent 100%
        );
      }

      .text-embedded__pre {
        font-family: monospace;
        white-space: pre-wrap;
        word-wrap: break-word;
        margin: 0;
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        line-height: 1.5;
      }
    </style>
  </template>
}

class Fitted extends Component<typeof TextFileDef> {
  get title() {
    return textTitle(this.args.model);
  }

  get excerpt() {
    return this.args.model?.excerpt ?? '';
  }

  get hasExcerpt() {
    return Boolean(this.excerpt);
  }

  <template>
    <article class='text-fitted' data-test-text-fitted>
      <div class='text-fitted__icon'>
        <TextFileIcon width='100%' height='100%' />
      </div>
      <div class='text-fitted__text'>
        <header class='text-fitted__title'>{{this.title}}</header>
        {{#if this.hasExcerpt}}
          <p class='text-fitted__excerpt'>{{this.excerpt}}</p>
        {{/if}}
      </div>
    </article>
    <style scoped>
      .text-fitted {
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

      .text-fitted__icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        color: var(--boxel-600);
      }

      .text-fitted__text {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }

      .text-fitted__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .text-fitted__excerpt {
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
        .text-fitted {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .text-fitted__icon {
          width: 28px;
          height: 28px;
        }

        .text-fitted__title {
          -webkit-line-clamp: 3;
        }
      }

      /* Portrait short: hide excerpt */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 120px) {
        .text-fitted__excerpt {
          display: none;
        }
      }

      /* Portrait very short: hide icon too */
      @container fitted-card (aspect-ratio <= 1.0) and (height < 80px) {
        .text-fitted__icon {
          display: none;
        }
      }

      /* Landscape: icon left of text */
      @container fitted-card (1.0 < aspect-ratio) {
        .text-fitted {
          align-items: flex-start;
        }
      }

      /* Landscape short: hide excerpt */
      @container fitted-card (1.0 < aspect-ratio) and (height < 80px) {
        .text-fitted__excerpt {
          display: none;
        }
      }

      /* Very small: title only, smaller font */
      @container fitted-card (height <= 57px) {
        .text-fitted__icon {
          display: none;
        }

        .text-fitted__excerpt {
          display: none;
        }

        .text-fitted__title {
          font-size: var(--boxel-font-xs);
          -webkit-line-clamp: 1;
        }
      }
    </style>
  </template>
}

class Atom extends Component<typeof TextFileDef> {
  get title() {
    return textTitle(this.args.model);
  }

  <template>
    <span class='text-atom' data-test-text-atom>
      <TextFileIcon class='text-atom__icon' width='16' height='16' />
      <span class='text-atom__title'>{{this.title}}</span>
    </span>
    <style scoped>
      .text-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }

      .text-atom__icon {
        flex-shrink: 0;
        color: var(--boxel-600);
      }

      .text-atom__title {
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

class Head extends Component<typeof TextFileDef> {
  get title() {
    return textTitle(this.args.model);
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

export class TextFileDef extends FileDef {
  static displayName = 'Text File';
  static icon = TextFileIcon;
  static acceptTypes = '.txt,.text,text/plain';

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
    if (!TEXT_EXTENSIONS.has(extension)) {
      throw new FileContentMismatchError(
        `Expected text file extension, got "${extension || 'none'}"`,
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
      title: fallbackTitle || 'Untitled text file',
      excerpt: truncateExcerpt(text.trim()),
      content: text,
    };
  }
}
