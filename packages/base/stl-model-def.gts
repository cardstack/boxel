import GlimmerComponent from '@glimmer/component';
import File3dIcon from '@cardstack/boxel-icons/file-3d';
import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { DEFAULT_FILE_SIZE_LIMIT_BYTES } from '@cardstack/runtime-common/constants';
import {
  BaseDefComponent,
  Component,
  FieldDef,
  StringField,
  contains,
  field,
} from './card-api';
import NumberField from './number';
import BooleanField from './boolean';
import {
  FileContentMismatchError,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import {
  ModelDef,
  ModelIsolatedBody,
  ModelInspectorSection,
  getExtension,
  type Model3dData,
  type ModelInspectorRow,
} from './model-file-def';
import { parseStl, type StlMetadata } from './stl-meta-extractor';

export class StlMetadataField extends FieldDef {
  static displayName = 'STL Mesh Metadata';
  static icon = File3dIcon;
  @field encoding = contains(StringField);
  @field solidName = contains(StringField);
  @field binaryHeader = contains(StringField);
  @field facetCount = contains(NumberField);
  @field normalCount = contains(NumberField);
  @field degenerateFacetCount = contains(NumberField);
  @field hasColorData = contains(BooleanField);
  @field sizeX = contains(NumberField);
  @field sizeY = contains(NumberField);
  @field sizeZ = contains(NumberField);

  static embedded = class Embedded extends Component<typeof StlMetadataField> {
    <template>
      <dl class='stl-meta'>
        {{#if @model.encoding}}<div><dt>Encoding</dt><dd
            >{{@model.encoding}}</dd></div>{{/if}}
        {{#if @model.solidName}}<div><dt>Solid</dt><dd
            >{{@model.solidName}}</dd></div>{{/if}}
        {{#if @model.facetCount}}<div><dt>Facets</dt><dd
            >{{@model.facetCount}}</dd></div>{{/if}}
        {{#if @model.normalCount}}<div><dt>Normals</dt><dd
            >{{@model.normalCount}}</dd></div>{{/if}}
        <div><dt>Color data</dt><dd>{{if
              @model.hasColorData
              'Present'
              'None'
            }}</dd></div>
        {{#if @model.sizeX}}<div><dt>Extents</dt><dd
              class='mono'
            >{{@model.sizeX}}
              ×
              {{@model.sizeY}}
              ×
              {{@model.sizeZ}}</dd></div>{{/if}}
        {{#if @model.degenerateFacetCount}}<div><dt>Degenerate</dt><dd
            >{{@model.degenerateFacetCount}}</dd></div>{{/if}}
      </dl>
      <style scoped>
        .stl-meta {
          margin: 0;
          display: grid;
          gap: 5px;
        }
        .stl-meta div {
          display: grid;
          grid-template-columns: 88px minmax(0, 1fr);
          gap: 10px;
        }
        dt {
          color: var(--boxel-450);
          font: 0.5625rem var(--boxel-monospace-font-family, monospace);
          text-transform: uppercase;
        }
        dd {
          min-width: 0;
          margin: 0;
          overflow-wrap: anywhere;
        }
        .mono {
          font-family: var(--boxel-monospace-font-family, monospace);
        }
      </style>
    </template>
  };
}

class StlIsolated extends GlimmerComponent<{ Args: { model: StlDef } }> {
  get stlRows(): ModelInspectorRow[] {
    let s = this.args.model.stlMetadata;
    let rows: ModelInspectorRow[] = [];
    if (!s) {
      return rows;
    }
    if (s.encoding) {
      rows.push({ term: 'Encoding', detail: s.encoding });
    }
    if (s.solidName) {
      rows.push({ term: 'Solid', detail: s.solidName });
    }
    if (s.facetCount) {
      rows.push({ term: 'Facets', detail: s.facetCount });
    }
    if (s.normalCount) {
      rows.push({ term: 'Normals', detail: s.normalCount });
    }
    rows.push({
      term: 'Color data',
      detail: s.hasColorData ? 'Present' : 'None',
    });
    if (s.sizeX) {
      rows.push({
        term: 'Extents',
        detail: `${s.sizeX} × ${s.sizeY} × ${s.sizeZ}`,
      });
    }
    if (s.degenerateFacetCount) {
      rows.push({ term: 'Degenerate', detail: s.degenerateFacetCount });
    }
    return rows;
  }

  <template>
    <ModelIsolatedBody @model={{@model}}>
      {{#if @model.stlMetadata}}
        <ModelInspectorSection @heading='STL mesh' @rows={{this.stlRows}} />
      {{/if}}
    </ModelIsolatedBody>
  </template>
}

export class StlDef extends ModelDef {
  static displayName = 'STL Mesh';
  static icon = File3dIcon;
  static acceptTypes = '.stl,model/stl,application/sla';

  @field stlMetadata = contains(StlMetadataField);

  get extents() {
    return {
      x: this.stlMetadata?.sizeX ?? 1,
      y: this.stlMetadata?.sizeY ?? 1,
      z: this.stlMetadata?.sizeZ ?? 1,
    };
  }

  static isolated: BaseDefComponent = StlIsolated;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: {
      contentHash?: string;
      contentSize?: number;
      // Backstop bound on the bytes we're willing to parse at index time,
      // threaded from the host; defaults to the realm's standard file-size
      // limit (`DEFAULT_FILE_SIZE_LIMIT_BYTES`), the same ceiling the write
      // path enforces, so the two can't drift.
      fileSizeLimitBytes?: number;
    } = {},
  ): Promise<
    // `model3d`/`stlMetadata` are optional: over the size cap we skip the parse
    // and return only the base file attributes (see below).
    SerializedFile<Partial<{ model3d: Model3dData; stlMetadata: StlMetadata }>>
  > {
    let extension = getExtension(url);
    if (extension !== '.stl') {
      throw new FileContentMismatchError(
        `Expected .stl file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    // Over the size cap, skip the parse but keep the StlDef type — the file
    // still renders via the live client-side viewer (which parses its own
    // geometry); it just has empty inspector panels and a generic silhouette.
    // Do NOT throw FileContentMismatchError here: that would demote the file to
    // a plain FileDef and lose the 3D card entirely.
    let sizeCap = options.fileSizeLimitBytes ?? DEFAULT_FILE_SIZE_LIMIT_BYTES;
    if (bytes.byteLength > sizeCap) {
      console.warn(
        `[StlDef] skipping metadata extraction for ${url}: ${bytes.byteLength} bytes exceeds cap ${sizeCap}`,
      );
      return { ...base };
    }
    let parsed = parseStl(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    if (!parsed) {
      throw new FileContentMismatchError(
        'File does not contain parseable STL geometry',
      );
    }
    return { ...base, ...parsed };
  }
}
