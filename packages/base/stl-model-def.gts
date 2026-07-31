import GlimmerComponent from '@glimmer/component';
import File3dIcon from '@cardstack/boxel-icons/file-3d';
import { byteStreamToUint8Array } from '@cardstack/runtime-common';
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
import { ModelDef, ModelIsolatedBody } from './model-file-def';

interface StlMetadata {
  encoding: string;
  solidName?: string;
  binaryHeader?: string;
  facetCount: number;
  normalCount: number;
  degenerateFacetCount: number;
  hasColorData: boolean;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
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

// Bounded STL parser. Pure JS (DataView/TextDecoder) so it runs identically in
// the browser, the indexer, and the prerender pass. Ported from the handoff
// realm's metadata-extractor. Produces both the generic scene facts (model3d)
// and STL-specific diagnostics (stlMetadata).
function parseStl(
  buf: ArrayBuffer,
): { model3d: Model3dData; stlMetadata: StlMetadata } | undefined {
  let bytes = new Uint8Array(buf);
  let view = new DataView(buf);
  let declaredBinaryFacets = bytes.length >= 84 ? view.getUint32(80, true) : 0;
  let expectedBinarySize = 84 + declaredBinaryFacets * 50;
  let isBinary = declaredBinaryFacets > 0 && expectedBinarySize <= bytes.length;
  let vertices: number[][] = [];
  let normalCount = 0;
  let facetCount = 0;
  let hasColorData = false;
  let solidName: string | undefined;
  let binaryHeader: string | undefined;

  if (isBinary) {
    binaryHeader =
      new TextDecoder('latin1')
        .decode(bytes.subarray(0, 80))
        .split('')
        .map((character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) > 126
            ? ' '
            : character,
        )
        .join('')
        .trim() || undefined;
    hasColorData = /COLOR=/i.test(binaryHeader ?? '');
    facetCount = Math.min(
      declaredBinaryFacets,
      Math.floor((bytes.length - 84) / 50),
    );
    for (let facet = 0; facet < facetCount; facet++) {
      let offset = 84 + facet * 50;
      let nx = view.getFloat32(offset, true);
      let ny = view.getFloat32(offset + 4, true);
      let nz = view.getFloat32(offset + 8, true);
      if (
        Number.isFinite(nx + ny + nz) &&
        Math.abs(nx) + Math.abs(ny) + Math.abs(nz) > 1e-12
      ) {
        normalCount++;
      }
      for (let vertex = 0; vertex < 3; vertex++) {
        let p = offset + 12 + vertex * 12;
        vertices.push([
          view.getFloat32(p, true),
          view.getFloat32(p + 4, true),
          view.getFloat32(p + 8, true),
        ]);
      }
      hasColorData ||= view.getUint16(offset + 48, true) !== 0;
    }
  } else {
    let text = new TextDecoder().decode(bytes);
    if (!/\bfacet\s+normal\b/i.test(text) || !/\bvertex\s+[-+\d.]/i.test(text)) {
      return undefined;
    }
    solidName = text.match(/^\s*solid(?:\s+([^\r\n]+))?/i)?.[1]?.trim() || undefined;
    let normalPattern =
      /\bfacet\s+normal\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi;
    for (let match; (match = normalPattern.exec(text)); ) {
      facetCount++;
      let magnitude =
        Math.abs(Number(match[1])) +
        Math.abs(Number(match[2])) +
        Math.abs(Number(match[3]));
      if (Number.isFinite(magnitude) && magnitude > 1e-12) {
        normalCount++;
      }
    }
    let vertexPattern = /\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi;
    for (let match; (match = vertexPattern.exec(text)); ) {
      vertices.push([Number(match[1]), Number(match[2]), Number(match[3])]);
    }
  }

  let finiteVertices = vertices.filter((vertex) => vertex.every(Number.isFinite));
  if (!facetCount || finiteVertices.length < 3) {
    return undefined;
  }
  let mins = [Infinity, Infinity, Infinity];
  let maxs = [-Infinity, -Infinity, -Infinity];
  for (let vertex of finiteVertices) {
    for (let axis = 0; axis < 3; axis++) {
      mins[axis] = Math.min(mins[axis], vertex[axis]);
      maxs[axis] = Math.max(maxs[axis], vertex[axis]);
    }
  }
  let degenerateFacetCount = 0;
  for (let i = 0; i + 2 < finiteVertices.length; i += 3) {
    let a = finiteVertices[i];
    let b = finiteVertices[i + 1];
    let c = finiteVertices[i + 2];
    let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2 < 1e-20) {
      degenerateFacetCount++;
    }
  }
  let round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  return {
    model3d: {
      meshes: 1,
      materials: hasColorData ? 1 : 0,
      vertices: finiteVertices.length,
      triangles: facetCount,
      generator: solidName ?? binaryHeader,
    },
    stlMetadata: {
      encoding: isBinary ? 'binary' : 'ASCII',
      solidName,
      binaryHeader,
      facetCount,
      normalCount,
      degenerateFacetCount,
      hasColorData,
      sizeX: round(maxs[0] - mins[0]),
      sizeY: round(maxs[1] - mins[1]),
      sizeZ: round(maxs[2] - mins[2]),
    },
  };
}

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
        {{#if @model.encoding}}<div><dt>Encoding</dt><dd>{{@model.encoding}}</dd></div>{{/if}}
        {{#if @model.solidName}}<div><dt>Solid</dt><dd>{{@model.solidName}}</dd></div>{{/if}}
        {{#if @model.facetCount}}<div><dt>Facets</dt><dd>{{@model.facetCount}}</dd></div>{{/if}}
        {{#if @model.normalCount}}<div><dt>Normals</dt><dd>{{@model.normalCount}}</dd></div>{{/if}}
        <div><dt>Color data</dt><dd>{{if @model.hasColorData 'Present' 'None'}}</dd></div>
        {{#if @model.sizeX}}<div><dt>Extents</dt><dd class='mono'>{{@model.sizeX}} × {{@model.sizeY}} × {{@model.sizeZ}}</dd></div>{{/if}}
        {{#if @model.degenerateFacetCount}}<div><dt>Degenerate</dt><dd>{{@model.degenerateFacetCount}}</dd></div>{{/if}}
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
  <template>
    <section class='stl-isolated'>
      <ModelIsolatedBody @model={{@model}} />
      {{#if @model.stlMetadata}}
        <dl class='stl-facts'>
          {{#if @model.stlMetadata.encoding}}<div><dt>Encoding</dt><dd>{{@model.stlMetadata.encoding}}</dd></div>{{/if}}
          {{#if @model.stlMetadata.solidName}}<div><dt>Solid</dt><dd>{{@model.stlMetadata.solidName}}</dd></div>{{/if}}
          {{#if @model.stlMetadata.facetCount}}<div><dt>Facets</dt><dd>{{@model.stlMetadata.facetCount}}</dd></div>{{/if}}
          <div><dt>Color data</dt><dd>{{if @model.stlMetadata.hasColorData 'Present' 'None'}}</dd></div>
          {{#if @model.stlMetadata.sizeX}}<div><dt>Extents</dt><dd class='mono'>{{@model.stlMetadata.sizeX}} × {{@model.stlMetadata.sizeY}} × {{@model.stlMetadata.sizeZ}}</dd></div>{{/if}}
          {{#if @model.stlMetadata.degenerateFacetCount}}<div><dt>Degenerate</dt><dd>{{@model.stlMetadata.degenerateFacetCount}}</dd></div>{{/if}}
        </dl>
      {{/if}}
    </section>
    <style scoped>
      .stl-isolated {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
      }
      .stl-facts {
        margin: 0;
        display: grid;
        gap: 5px;
      }
      .stl-facts div {
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
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ model3d: Model3dData; stlMetadata: StlMetadata }>> {
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
