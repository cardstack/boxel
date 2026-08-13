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
import {
  FileContentMismatchError,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import {
  ThreeDModelDef,
  ModelIsolatedBody,
  ModelInspectorSection,
  getExtension,
  type ModelInspectorRow,
} from './three-d-model-def';
import { parseGltf, type GltfMetadata } from './gltf-meta-extractor';

// The structural facts the glTF header carries. Shared by both leaves — a `.glb`
// is the same glTF document in a binary wrapper — so the JSON and binary forms
// read identically in the inspector.
export class GltfMetadataField extends FieldDef {
  static displayName = 'glTF Model Metadata';
  static icon = File3dIcon;
  @field container = contains(StringField);
  @field gltfVersion = contains(StringField);
  @field generator = contains(StringField);
  @field meshCount = contains(NumberField);
  @field materialCount = contains(NumberField);
  @field nodeCount = contains(NumberField);
  @field animationCount = contains(NumberField);
  @field textureCount = contains(NumberField);
  @field vertexCount = contains(NumberField);
  @field triangleCount = contains(NumberField);
  @field dimensions = contains(StringField);

  static embedded = class Embedded extends Component<typeof GltfMetadataField> {
    <template>
      <dl class='gltf-meta'>
        {{#if @model.gltfVersion}}<div><dt>Version</dt><dd
            >glTF {{@model.gltfVersion}}</dd></div>{{/if}}
        {{#if @model.generator}}<div><dt>Generator</dt><dd
            >{{@model.generator}}</dd></div>{{/if}}
        {{#if @model.vertexCount}}<div><dt>Vertices</dt><dd
            >{{@model.vertexCount}}</dd></div>{{/if}}
        {{#if @model.triangleCount}}<div><dt>Triangles</dt><dd
            >{{@model.triangleCount}}</dd></div>{{/if}}
        {{#if @model.dimensions}}<div><dt>Size</dt><dd
            >{{@model.dimensions}}</dd></div>{{/if}}
        {{#if @model.meshCount}}<div><dt>Meshes</dt><dd
            >{{@model.meshCount}}</dd></div>{{/if}}
        {{#if @model.materialCount}}<div><dt>Materials</dt><dd
            >{{@model.materialCount}}</dd></div>{{/if}}
        {{#if @model.nodeCount}}<div><dt>Nodes</dt><dd
            >{{@model.nodeCount}}</dd></div>{{/if}}
        {{#if @model.animationCount}}<div><dt>Animations</dt><dd
            >{{@model.animationCount}}</dd></div>{{/if}}
        {{#if @model.textureCount}}<div><dt>Textures</dt><dd
            >{{@model.textureCount}}</dd></div>{{/if}}
      </dl>
      <style scoped>
        .gltf-meta {
          margin: 0;
          display: grid;
          gap: 5px;
        }
        .gltf-meta div {
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
      </style>
    </template>
  };
}

// Both leaves share this inspector body: the metadata shape is identical, so a
// `.glb` and a `.gltf` list the same facts beneath the shared live viewer.
class GltfIsolated extends GlimmerComponent<{ Args: { model: GltfDef } }> {
  get gltfRows(): ModelInspectorRow[] {
    let g = this.args.model.gltfMetadata;
    let rows: ModelInspectorRow[] = [];
    if (!g) {
      return rows;
    }
    if (g.gltfVersion) {
      rows.push({ term: 'Version', detail: `glTF ${g.gltfVersion}` });
    }
    if (g.generator) {
      rows.push({ term: 'Generator', detail: g.generator });
    }
    if (g.vertexCount) {
      rows.push({ term: 'Vertices', detail: g.vertexCount });
    }
    if (g.triangleCount) {
      rows.push({ term: 'Triangles', detail: g.triangleCount });
    }
    if (g.dimensions) {
      rows.push({ term: 'Size', detail: g.dimensions });
    }
    if (g.meshCount) {
      rows.push({ term: 'Meshes', detail: g.meshCount });
    }
    if (g.materialCount) {
      rows.push({ term: 'Materials', detail: g.materialCount });
    }
    if (g.nodeCount) {
      rows.push({ term: 'Nodes', detail: g.nodeCount });
    }
    if (g.animationCount) {
      rows.push({ term: 'Animations', detail: g.animationCount });
    }
    if (g.textureCount) {
      rows.push({ term: 'Textures', detail: g.textureCount });
    }
    return rows;
  }

  <template>
    <ModelIsolatedBody @model={{@model}}>
      {{#if @model.gltfMetadata}}
        <ModelInspectorSection @heading='glTF model' @rows={{this.gltfRows}} />
      {{/if}}
    </ModelIsolatedBody>
  </template>
}

// A shared extract step for both leaves: the container form is auto-detected by
// `parseGltf`, so the only per-format difference is which extension is accepted.
async function extractGltfAttributes(
  expectedExtension: '.gltf' | '.glb',
  containerLabel: string,
  url: string,
  getStream: () => Promise<ByteStream>,
  options: { contentHash?: string; contentSize?: number; fileSizeLimitBytes?: number },
): Promise<SerializedFile<Partial<{ gltfMetadata: GltfMetadata }>>> {
  let extension = getExtension(url);
  if (extension !== expectedExtension) {
    throw new FileContentMismatchError(
      `Expected ${expectedExtension} file extension, got "${extension || 'none'}"`,
    );
  }

  let bytesPromise: Promise<Uint8Array> | undefined;
  let memoizedStream = async () => {
    bytesPromise ??= byteStreamToUint8Array(await getStream());
    return bytesPromise;
  };

  let base = await ThreeDModelDef.extractAttributes(url, memoizedStream, options);
  let bytes = await memoizedStream();
  // Over the size cap, keep the model type but skip the sniff — the file still
  // renders through the live client-side viewer, which parses its own geometry;
  // it just has an empty inspector panel. Do NOT throw here: that would demote
  // the file to a plain FileDef and lose the 3D card entirely.
  let sizeCap = options.fileSizeLimitBytes ?? DEFAULT_FILE_SIZE_LIMIT_BYTES;
  if (bytes.byteLength > sizeCap) {
    console.warn(
      `[GltfModelDef] skipping metadata extraction for ${url}: ${bytes.byteLength} bytes exceeds cap ${sizeCap}`,
    );
    return { ...base };
  }
  let parsed = parseGltf(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  if (!parsed) {
    throw new FileContentMismatchError(
      `File does not contain a parseable ${containerLabel}`,
    );
  }
  return { ...base, ...parsed };
}

// The JSON form (`.gltf`). Its buffers and textures may be external or embedded
// as base64; the header read here needs neither.
export class GltfDef extends ThreeDModelDef {
  static displayName = 'glTF Model';
  static icon = File3dIcon;
  static acceptTypes = '.gltf,model/gltf+json';

  @field gltfMetadata = contains(GltfMetadataField);

  static isolated: BaseDefComponent = GltfIsolated;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: {
      contentHash?: string;
      contentSize?: number;
      fileSizeLimitBytes?: number;
    } = {},
  ): Promise<SerializedFile<Partial<{ gltfMetadata: GltfMetadata }>>> {
    return extractGltfAttributes(
      '.gltf',
      'glTF JSON document',
      url,
      getStream,
      options,
    );
  }
}

// The binary form (`.glb`). The same glTF document wrapped in a chunked
// container; `parseGltf` reads only its JSON chunk, never the geometry that
// follows.
export class GlbDef extends ThreeDModelDef {
  static displayName = 'glTF Binary Model';
  static icon = File3dIcon;
  static acceptTypes = '.glb,model/gltf-binary';

  @field gltfMetadata = contains(GltfMetadataField);

  static isolated: BaseDefComponent = GltfIsolated;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: {
      contentHash?: string;
      contentSize?: number;
      fileSizeLimitBytes?: number;
    } = {},
  ): Promise<SerializedFile<Partial<{ gltfMetadata: GltfMetadata }>>> {
    return extractGltfAttributes(
      '.glb',
      'GLB container',
      url,
      getStream,
      options,
    );
  }
}
