import { readFirstBytes } from '@cardstack/runtime-common';
import CubeIcon from '@cardstack/boxel-icons/cube';
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
import { STL_SNIFF_BYTES, extractStlFormat } from './stl-meta-extractor';

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

function stlTitle(model: { name?: string | null } | null | undefined): string {
  return model?.name ?? 'Untitled 3D Model';
}

// Human label for the stored `format` value; blank when the encoding is
// unknown (e.g. a bare FileDef fallback that never ran STL extraction).
function formatLabel(format: string | null | undefined): string {
  if (format === 'binary') {
    return 'Binary STL';
  }
  if (format === 'ascii') {
    return 'ASCII STL';
  }
  return '';
}

class Isolated extends Component<typeof StlDef> {
  get title() {
    return stlTitle(this.args.model);
  }

  get formatLabel() {
    return formatLabel(this.args.model?.format);
  }

  <template>
    <article class='stl-isolated' data-test-stl-isolated>
      <div class='stl-isolated__icon'>
        <CubeIcon width='100%' height='100%' />
      </div>
      <header class='stl-isolated__title'>{{this.title}}</header>
      {{#if this.formatLabel}}
        <p class='stl-isolated__format' data-test-stl-format>
          {{this.formatLabel}}
        </p>
      {{/if}}
    </article>
    <style scoped>
      .stl-isolated {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-lg);
        text-align: center;
      }

      .stl-isolated__icon {
        width: 96px;
        height: 96px;
        color: var(--boxel-600);
      }

      .stl-isolated__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-size-lg);
      }

      .stl-isolated__format {
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
        margin: 0;
      }
    </style>
  </template>
}

class Embedded extends Component<typeof StlDef> {
  get title() {
    return stlTitle(this.args.model);
  }

  get formatLabel() {
    return formatLabel(this.args.model?.format);
  }

  <template>
    <article class='stl-embedded' data-test-stl-embedded>
      <div class='stl-embedded__icon'>
        <CubeIcon width='100%' height='100%' />
      </div>
      <div class='stl-embedded__text'>
        <header class='stl-embedded__title'>{{this.title}}</header>
        {{#if this.formatLabel}}
          <p class='stl-embedded__format' data-test-stl-format>
            {{this.formatLabel}}
          </p>
        {{/if}}
      </div>
    </article>
    <style scoped>
      .stl-embedded {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
      }

      .stl-embedded__icon {
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        color: var(--boxel-600);
      }

      .stl-embedded__text {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }

      .stl-embedded__title {
        color: var(--boxel-900);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stl-embedded__format {
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
        margin: 0;
      }
    </style>
  </template>
}

class Fitted extends Component<typeof StlDef> {
  get title() {
    return stlTitle(this.args.model);
  }

  get formatLabel() {
    return formatLabel(this.args.model?.format);
  }

  <template>
    <article class='stl-fitted' data-test-stl-fitted>
      <div class='stl-fitted__icon'>
        <CubeIcon width='100%' height='100%' />
      </div>
      <div class='stl-fitted__text'>
        <header class='stl-fitted__title'>{{this.title}}</header>
        {{#if this.formatLabel}}
          <p class='stl-fitted__format'>{{this.formatLabel}}</p>
        {{/if}}
      </div>
    </article>
    <style scoped>
      .stl-fitted {
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

      .stl-fitted__icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        color: var(--boxel-600);
      }

      .stl-fitted__text {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }

      .stl-fitted__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .stl-fitted__format {
        color: var(--boxel-600);
        font-size: var(--boxel-font-xs);
        margin: 0;
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height >= 120px) {
        .stl-fitted {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .stl-fitted__icon {
          width: 28px;
          height: 28px;
        }
      }

      @container fitted-card (height <= 57px) {
        .stl-fitted__icon {
          display: none;
        }

        .stl-fitted__format {
          display: none;
        }

        .stl-fitted__title {
          font-size: var(--boxel-font-xs);
          -webkit-line-clamp: 1;
        }
      }
    </style>
  </template>
}

class Atom extends Component<typeof StlDef> {
  get title() {
    return stlTitle(this.args.model);
  }

  <template>
    <span class='stl-atom' data-test-stl-atom>
      <CubeIcon class='stl-atom__icon' width='16' height='16' />
      <span class='stl-atom__title'>{{this.title}}</span>
    </span>
    <style scoped>
      .stl-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }

      .stl-atom__icon {
        flex-shrink: 0;
        color: var(--boxel-600);
      }

      .stl-atom__title {
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

export class StlDef extends FileDef {
  static displayName = '3D Model (STL)';
  static icon = CubeIcon;
  static acceptTypes = '.stl,model/stl';
  static validExtensions = new Set(['.stl']);

  @field format = contains(StringField);

  static isolated: BaseDefComponent = Isolated;
  static embedded: BaseDefComponent = Embedded;
  static fitted: BaseDefComponent = Fitted;
  static atom: BaseDefComponent = Atom;

  static async extractAttributes(
    this: typeof StlDef,
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ format: string }>> {
    let extension = getExtension(url);
    if (!this.validExtensions.has(extension)) {
      throw new FileContentMismatchError(
        `Expected ${[...this.validExtensions].join(' or ')} file extension, got "${extension || 'none'}"`,
      );
    }

    let base = await super.extractAttributes(url, getStream, options);
    let bytes = await readFirstBytes(await getStream(), STL_SNIFF_BYTES);
    let contentSize = base.contentSize ?? bytes.byteLength;
    let { format } = extractStlFormat(bytes, contentSize);

    return {
      ...base,
      format,
    };
  }
}
