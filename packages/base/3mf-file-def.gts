import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import Cube3dSphereIcon from '@cardstack/boxel-icons/cube-3d-sphere';
import {
  BaseDefComponent,
  Component,
  StringField,
  contains,
  field,
} from './card-api';
import BooleanField from './boolean';
import {
  FileDef,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import { extract3mfMetadata } from './3mf-meta-extractor';

type ThreeMfExtra = {
  title?: string;
  designer?: string;
  description?: string;
  license?: string;
  unit?: string;
  hasThumbnail: boolean;
};

function threeMfTitle(
  model: { title?: string | null; name?: string | null } | null | undefined,
): string {
  return model?.title ?? model?.name ?? 'Untitled 3MF model';
}

class Isolated extends Component<typeof ThreeMfDef> {
  get title() {
    return threeMfTitle(this.args.model);
  }
  <template>
    <article class='threemf-isolated' data-test-threemf-isolated>
      <header class='threemf-isolated__header'>
        <Cube3dSphereIcon
          class='threemf-isolated__icon'
          width='32'
          height='32'
        />
        <div class='threemf-isolated__heading'>
          <div class='threemf-isolated__title'>{{this.title}}</div>
          {{#if @model.designer}}
            <div class='threemf-isolated__designer'>by {{@model.designer}}</div>
          {{/if}}
        </div>
      </header>
      {{#if @model.description}}
        <p class='threemf-isolated__description'>{{@model.description}}</p>
      {{/if}}
      <dl class='threemf-isolated__facts'>
        {{#if @model.unit}}
          <div class='threemf-isolated__fact'>
            <dt>Units</dt>
            <dd>{{@model.unit}}</dd>
          </div>
        {{/if}}
        {{#if @model.license}}
          <div class='threemf-isolated__fact'>
            <dt>License</dt>
            <dd>{{@model.license}}</dd>
          </div>
        {{/if}}
      </dl>
    </article>
    <style scoped>
      .threemf-isolated {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
        max-width: 100%;
      }
      .threemf-isolated__header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
      }
      .threemf-isolated__icon {
        color: var(--boxel-600);
        flex-shrink: 0;
      }
      .threemf-isolated__heading {
        min-width: 0;
        flex: 1;
      }
      .threemf-isolated__title {
        font-weight: 600;
        color: var(--boxel-900);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .threemf-isolated__designer {
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
      }
      .threemf-isolated__description {
        color: var(--boxel-700);
        margin: 0;
      }
      .threemf-isolated__facts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp) var(--boxel-sp-lg);
        margin: 0;
      }
      .threemf-isolated__fact {
        display: flex;
        flex-direction: column;
      }
      .threemf-isolated__fact dt {
        color: var(--boxel-500);
        font-size: var(--boxel-font-xs);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .threemf-isolated__fact dd {
        color: var(--boxel-900);
        margin: 0;
      }
    </style>
  </template>
}

class Embedded extends Component<typeof ThreeMfDef> {
  get title() {
    return threeMfTitle(this.args.model);
  }
  <template>
    <div class='threemf-embedded' data-test-threemf-embedded>
      <Cube3dSphereIcon
        class='threemf-embedded__icon'
        width='20'
        height='20'
      />
      <div class='threemf-embedded__meta'>
        <div class='threemf-embedded__title'>{{this.title}}</div>
        {{#if @model.designer}}
          <div class='threemf-embedded__designer'>by {{@model.designer}}</div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .threemf-embedded {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .threemf-embedded__icon {
        color: var(--boxel-600);
        flex-shrink: 0;
      }
      .threemf-embedded__meta {
        min-width: 0;
      }
      .threemf-embedded__title {
        font-weight: 600;
        color: var(--boxel-900);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .threemf-embedded__designer {
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
      }
    </style>
  </template>
}

// 3MF (3D Manufacturing Format) — the ZIP+XML successor to STL used for 3D
// printing. Unlike STL, it self-describes with title/designer/description/
// license text that is not in the filename, so extracting it delivers real
// full-text search value. See `3mf-meta-extractor.ts` for the bounded parse.
export class ThreeMfDef extends FileDef {
  static displayName = '3MF Model';
  static icon = Cube3dSphereIcon;
  static acceptTypes = '.3mf,model/3mf';

  @field title = contains(StringField);
  @field designer = contains(StringField);
  @field description = contains(StringField);
  @field license = contains(StringField);
  @field unit = contains(StringField);
  @field hasThumbnail = contains(BooleanField);

  static isolated: BaseDefComponent = Isolated;
  static embedded: BaseDefComponent = Embedded;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<ThreeMfExtra>> {
    let base = await super.extractAttributes(url, getStream, options);
    // 3MF is a ZIP container, so we need the whole file in memory to unzip it;
    // `extract3mfMetadata` then bounds the XML parse to the model header.
    let bytes = await byteStreamToUint8Array(await getStream());
    let metadata = extract3mfMetadata(bytes);
    return { ...base, ...metadata };
  }
}

export default ThreeMfDef;
