import GlimmerComponent from '@glimmer/component';
import { unzipSync, strFromU8 } from 'fflate';
import PrinterIcon from '@cardstack/boxel-icons/printer';
import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import {
  BaseDefComponent,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
} from './card-api';
import NumberField from './number';
import TextAreaField from './text-area';
import {
  FileContentMismatchError,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import { ModelDef, ModelIsolatedBody } from './model-file-def';

interface ThreeMfPrintPartData {
  name?: string;
  extruder?: number;
  faceCount?: number;
}

interface ThreeMfMetadata {
  unit?: string;
  language?: string;
  modelPart?: string;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  packageEntryCount?: number;
  objectCount?: number;
  buildItemCount?: number;
  componentCount?: number;
  textureCount?: number;
  materialResourceCount?: number;
  extensionCount?: number;
  extensions?: string[];
  title?: string;
  designer?: string;
  application?: string;
  bambuStudioVersion?: string;
  creationDate?: string;
  licenseTerms?: string;
  description?: string;
  plateCount?: number;
  printPartCount?: number;
  configuredFaceCount?: number;
  extruderCount?: number;
  materialNames?: string[];
  materialColors?: string[];
  printParts?: ThreeMfPrintPartData[];
}

interface Model3dData {
  meshes: number;
  materials: number;
  vertices: number;
  triangles: number;
  generator?: string;
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

// Bounded 3MF (OPC ZIP) parser. Unzips the package, parses the model part(s)
// and the optional slicer config, and returns the generic scene facts plus the
// 3MF-specific package metadata. Uses `fflate` (bundled dependency, not a CDN
// import) and the runtime `DOMParser` (available in the host/prerender
// Chromium). Ported from the handoff realm's metadata-extractor.
function parseThreeMf(
  buf: ArrayBuffer,
): { model3d: Model3dData; threeMfMetadata: ThreeMfMetadata } | undefined {
  let files = unzipSync(new Uint8Array(buf)) as Record<string, Uint8Array>;
  let modelPart = Object.keys(files).find(
    (path) => /(?:^|\/)3dmodel\.model$/i.test(path) || /\.model$/i.test(path),
  );
  if (!modelPart) {
    return undefined;
  }
  let modelDocuments = Object.entries(files)
    .filter(([path]) => /\.model$/i.test(path))
    .map(([path, bytes]) => {
      let document = new DOMParser().parseFromString(
        strFromU8(bytes),
        'application/xml',
      );
      if (document.getElementsByTagName('parsererror').length) {
        throw new FileContentMismatchError(
          `3MF model XML is malformed: ${path}`,
        );
      }
      return { path, document, root: document.documentElement };
    });
  let primary =
    modelDocuments.find(({ path }) => path === modelPart) ?? modelDocuments[0];
  let root = primary.root;
  let elements = (name: string) =>
    modelDocuments.flatMap(({ document }) =>
      Array.from(document.getElementsByTagNameNS('*', name)),
    );
  let metadata = new Map<string, string>();
  for (let element of elements('metadata')) {
    let key = element.getAttribute('name');
    if (key) {
      metadata.set(key.toLowerCase(), element.textContent?.trim() ?? '');
    }
  }
  let extensions = Array.from(
    new Set(
      modelDocuments.flatMap(({ root }) =>
        Array.from(root.attributes)
          .filter((attribute) => attribute.name.startsWith('xmlns:'))
          .map(
            (attribute) => `${attribute.name.slice(6)} · ${attribute.value}`,
          ),
      ),
    ),
  );
  let materialResourceCount = [
    'basematerials',
    'colorgroup',
    'texture2dgroup',
    'compositematerials',
    'multiproperties',
  ].reduce((total, name) => total + elements(name).length, 0);
  let materialBases = elements('base');
  let materialNames = materialBases
    .map((element) => element.getAttribute('name'))
    .filter((value): value is string => Boolean(value));
  let materialColors = materialBases
    .map((element) => element.getAttribute('displaycolor'))
    .filter((value): value is string => Boolean(value));
  let vertices = elements('vertex')
    .map((element) =>
      ['x', 'y', 'z'].map((axis) => Number(element.getAttribute(axis))),
    )
    .filter((vertex) => vertex.every(Number.isFinite));
  let mins = [Infinity, Infinity, Infinity];
  let maxs = [-Infinity, -Infinity, -Infinity];
  for (let vertex of vertices) {
    for (let axis = 0; axis < 3; axis++) {
      mins[axis] = Math.min(mins[axis], vertex[axis]);
      maxs[axis] = Math.max(maxs[axis], vertex[axis]);
    }
  }
  let dimension = (axis: number) =>
    vertices.length
      ? Math.round((maxs[axis] - mins[axis]) * 1_000_000) / 1_000_000
      : undefined;
  let configPath = Object.keys(files).find((path) =>
    /(?:^|\/)model_settings\.config$/i.test(path),
  );
  let configuredParts: ThreeMfPrintPartData[] = [];
  let plateCount = 0;
  let configuredFaceCount = 0;
  let extruders = new Set<number>();
  if (configPath) {
    let config = new DOMParser().parseFromString(
      strFromU8(files[configPath]),
      'application/xml',
    );
    if (!config.getElementsByTagName('parsererror').length) {
      plateCount = config.getElementsByTagName('plate').length;
      for (let part of Array.from(config.getElementsByTagName('part'))) {
        let values = new Map<string, string>();
        for (let child of Array.from(part.children)) {
          if (child.localName === 'metadata') {
            let key = child.getAttribute('key');
            if (key) {
              values.set(key, child.getAttribute('value') ?? '');
            }
          }
        }
        let meshStat = Array.from(part.children).find(
          (child) => child.localName === 'mesh_stat',
        );
        let faceCount = Number(meshStat?.getAttribute('face_count') ?? 0);
        let extruder = Number(values.get('extruder') ?? 0);
        if (extruder > 0) {
          extruders.add(extruder);
        }
        configuredFaceCount += Number.isFinite(faceCount) ? faceCount : 0;
        configuredParts.push({
          name:
            values.get('name') ||
            `Part ${part.getAttribute('id') ?? configuredParts.length + 1}`,
          extruder: extruder || undefined,
          faceCount: faceCount || undefined,
        });
      }
    }
  }
  if (!configuredParts.length) {
    for (let object of elements('object')) {
      let triangleCount = object.getElementsByTagNameNS('*', 'triangle').length;
      if (triangleCount) {
        configuredParts.push({
          name:
            object.getAttribute('name') ||
            `Object ${object.getAttribute('id') ?? configuredParts.length + 1}`,
          faceCount: triangleCount,
        });
      }
    }
  }
  let application =
    metadata.get('application') ??
    metadata.get('producer') ??
    metadata.get('generator');
  return {
    model3d: {
      meshes: elements('mesh').length,
      materials: materialResourceCount,
      vertices: elements('vertex').length,
      triangles: elements('triangle').length,
      generator: application ?? metadata.get('designer'),
    },
    threeMfMetadata: {
      unit: root.getAttribute('unit') ?? 'millimeter',
      language: root.getAttribute('xml:lang') ?? undefined,
      modelPart,
      sizeX: dimension(0),
      sizeY: dimension(1),
      sizeZ: dimension(2),
      packageEntryCount: Object.keys(files).length,
      objectCount: elements('object').length,
      buildItemCount: elements('item').length,
      componentCount: elements('component').length,
      textureCount: elements('texture2d').length,
      materialResourceCount,
      extensionCount: extensions.length,
      extensions,
      title: metadata.get('title'),
      designer: metadata.get('designer'),
      application,
      bambuStudioVersion: metadata.get('bambustudio:3mfversion'),
      creationDate: metadata.get('creationdate'),
      licenseTerms: metadata.get('licenseterms'),
      description: metadata.get('description'),
      plateCount: plateCount || undefined,
      printPartCount: configuredParts.length || undefined,
      configuredFaceCount: configuredFaceCount || undefined,
      extruderCount: extruders.size || undefined,
      materialNames,
      materialColors,
      printParts: configuredParts,
    },
  };
}

export class ThreeMfPrintPartField extends FieldDef {
  static displayName = '3MF Print Part';
  @field name = contains(StringField);
  @field extruder = contains(NumberField);
  @field faceCount = contains(NumberField);

  static embedded = class Embedded extends Component<
    typeof ThreeMfPrintPartField
  > {
    <template>
      <div class='part'>
        <span>{{if @model.name @model.name 'Unnamed part'}}</span>
        {{#if @model.extruder}}<small>Extruder
            {{@model.extruder}}</small>{{/if}}
        {{#if @model.faceCount}}<small>{{@model.faceCount}} faces</small>{{/if}}
      </div>
      <style scoped>
        .part {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 4px 10px;
          min-width: 0;
        }
        .part span {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .part small {
          color: var(--boxel-450);
          font: 0.5625rem var(--boxel-monospace-font-family, monospace);
        }
      </style>
    </template>
  };
}

export class ThreeMfMetadataField extends FieldDef {
  static displayName = '3MF Package Metadata';
  static icon = PrinterIcon;
  @field unit = contains(StringField);
  @field language = contains(StringField);
  @field modelPart = contains(StringField);
  @field sizeX = contains(NumberField);
  @field sizeY = contains(NumberField);
  @field sizeZ = contains(NumberField);
  @field packageEntryCount = contains(NumberField);
  @field objectCount = contains(NumberField);
  @field buildItemCount = contains(NumberField);
  @field componentCount = contains(NumberField);
  @field textureCount = contains(NumberField);
  @field materialResourceCount = contains(NumberField);
  @field extensionCount = contains(NumberField);
  @field extensions = containsMany(StringField);
  @field title = contains(StringField);
  @field designer = contains(StringField);
  @field application = contains(StringField);
  @field bambuStudioVersion = contains(StringField);
  @field creationDate = contains(StringField);
  @field licenseTerms = contains(StringField);
  @field description = contains(TextAreaField);
  @field plateCount = contains(NumberField);
  @field printPartCount = contains(NumberField);
  @field configuredFaceCount = contains(NumberField);
  @field extruderCount = contains(NumberField);
  @field materialNames = containsMany(StringField);
  @field materialColors = containsMany(StringField);
  @field printParts = containsMany(ThreeMfPrintPartField);

  static embedded = class Embedded extends Component<
    typeof ThreeMfMetadataField
  > {
    get materialList() {
      return (this.args.model?.materialNames ?? []).join(', ');
    }
    <template>
      <dl class='three-mf-meta'>
        {{#if @model.unit}}<div><dt>Units</dt><dd
            >{{@model.unit}}</dd></div>{{/if}}
        {{#if @model.sizeX}}<div><dt>Bounds</dt><dd>{{@model.sizeX}}
              ×
              {{@model.sizeY}}
              ×
              {{@model.sizeZ}}
              {{@model.unit}}</dd></div>{{/if}}
        {{#if @model.objectCount}}<div><dt>Objects</dt><dd
            >{{@model.objectCount}}</dd></div>{{/if}}
        {{#if @model.buildItemCount}}<div><dt>Build items</dt><dd
            >{{@model.buildItemCount}}</dd></div>{{/if}}
        {{#if @model.textureCount}}<div><dt>Textures</dt><dd
            >{{@model.textureCount}}</dd></div>{{/if}}
        {{#if @model.designer}}<div><dt>Designer</dt><dd
            >{{@model.designer}}</dd></div>{{/if}}
        {{#if @model.licenseTerms}}<div><dt>License</dt><dd
            >{{@model.licenseTerms}}</dd></div>{{/if}}
        {{#if @model.bambuStudioVersion}}<div><dt>Bambu 3MF</dt><dd
            >{{@model.bambuStudioVersion}}</dd></div>{{/if}}
        {{#if @model.plateCount}}<div><dt>Plates</dt><dd
            >{{@model.plateCount}}</dd></div>{{/if}}
        {{#if @model.printPartCount}}<div><dt>Print parts</dt><dd
            >{{@model.printPartCount}}</dd></div>{{/if}}
        {{#if @model.extruderCount}}<div><dt>Extruders</dt><dd
            >{{@model.extruderCount}}</dd></div>{{/if}}
        {{#if @model.materialNames.length}}<div><dt>Materials</dt><dd
            >{{this.materialList}}</dd></div>{{/if}}
        {{#if @model.modelPart}}<div><dt>Model part</dt><dd
              class='mono'
            >{{@model.modelPart}}</dd></div>{{/if}}
        {{#if @model.printParts.length}}
          <div class='parts'><dt>Configured parts</dt><dd>{{#each
                @fields.printParts
                as |Part|
              }}<Part />{{/each}}</dd></div>
        {{/if}}
      </dl>
      <style scoped>
        .three-mf-meta {
          margin: 0;
          display: grid;
          gap: 5px;
        }
        .three-mf-meta div {
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
        .parts dd {
          display: grid;
          gap: 4px;
        }
        .mono {
          font-family: var(--boxel-monospace-font-family, monospace);
        }
      </style>
    </template>
  };
}

class ThreeMfIsolated extends GlimmerComponent<{
  Args: { model: ThreeMfDef };
}> {
  <template>
    <ModelIsolatedBody @model={{@model}}>
      {{#if @model.threeMfMetadata}}
        <section class='insp-group'>
          <h2 class='insp-head'>3MF package</h2>
          <dl class='insp-rows'>
            {{#if @model.threeMfMetadata.unit}}<div><dt>Units</dt><dd
                >{{@model.threeMfMetadata.unit}}</dd></div>{{/if}}
            {{#if @model.threeMfMetadata.sizeX}}<div><dt>Bounds</dt><dd
                >{{@model.threeMfMetadata.sizeX}}
                  ×
                  {{@model.threeMfMetadata.sizeY}}
                  ×
                  {{@model.threeMfMetadata.sizeZ}}
                  {{@model.threeMfMetadata.unit}}</dd></div>{{/if}}
            {{#if @model.threeMfMetadata.objectCount}}<div><dt>Objects</dt><dd
                >{{@model.threeMfMetadata.objectCount}}</dd></div>{{/if}}
            {{#if @model.threeMfMetadata.plateCount}}<div><dt>Plates</dt><dd
                >{{@model.threeMfMetadata.plateCount}}</dd></div>{{/if}}
            {{#if @model.threeMfMetadata.printPartCount}}<div><dt>Print parts</dt><dd
                >{{@model.threeMfMetadata.printPartCount}}</dd></div>{{/if}}
            {{#if @model.threeMfMetadata.extruderCount}}<div><dt
                >Extruders</dt><dd
                >{{@model.threeMfMetadata.extruderCount}}</dd></div>{{/if}}
            {{#if @model.threeMfMetadata.designer}}<div><dt>Designer</dt><dd
                >{{@model.threeMfMetadata.designer}}</dd></div>{{/if}}
            {{#if @model.threeMfMetadata.application}}<div><dt
                >Application</dt><dd
                >{{@model.threeMfMetadata.application}}</dd></div>{{/if}}
          </dl>
        </section>
      {{/if}}
    </ModelIsolatedBody>
    <style scoped>
      .insp-group {
        margin-top: 0.875rem;
      }
      .insp-head {
        margin: 0 0 0.25rem;
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: 0.5625rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .insp-rows {
        margin: 0;
        display: flex;
        flex-direction: column;
      }
      .insp-rows div {
        display: grid;
        grid-template-columns: 5.75rem minmax(0, 1fr);
        gap: 0.625rem;
        align-items: baseline;
        padding: 0.3125rem 0;
        border-top: 1px solid var(--border);
      }
      .insp-rows div:first-child {
        border-top: 0;
      }
      .insp-rows dt {
        color: var(--muted-foreground);
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: 0.59375rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .insp-rows dd {
        min-width: 0;
        margin: 0;
        font-size: 0.75rem;
        overflow-wrap: anywhere;
      }
    </style>
  </template>
}

export class ThreeMfDef extends ModelDef {
  static displayName = '3MF Package';
  static icon = PrinterIcon;
  static acceptTypes = '.3mf,model/3mf,application/vnd.ms-3mfdocument';

  @field threeMfMetadata = contains(ThreeMfMetadataField);

  get extents() {
    return {
      x: this.threeMfMetadata?.sizeX ?? 1,
      y: this.threeMfMetadata?.sizeY ?? 1,
      z: this.threeMfMetadata?.sizeZ ?? 1,
    };
  }

  static isolated: BaseDefComponent = ThreeMfIsolated;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<
    SerializedFile<{ model3d: Model3dData; threeMfMetadata: ThreeMfMetadata }>
  > {
    let extension = getExtension(url);
    if (extension !== '.3mf') {
      throw new FileContentMismatchError(
        `Expected .3mf file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let parsed = parseThreeMf(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    if (!parsed) {
      throw new FileContentMismatchError('File is not a parseable 3MF package');
    }
    return { ...base, ...parsed };
  }
}
