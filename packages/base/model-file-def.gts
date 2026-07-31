import GlimmerComponent from '@glimmer/component';
import File3dIcon from '@cardstack/boxel-icons/file-3d';
import {
  BaseDefComponent,
  FieldDef,
  FileDef,
  StringField,
  contains,
  field,
} from './card-api';
import NumberField from './number';

// Generic scene facts shared by every 3D model format (STL, 3MF, and later
// GLB/glTF). Format-specific facts (STL facet counts, 3MF print parts) live on
// the leaf's own metadata FieldDef, not here.
export class Model3DInfoField extends FieldDef {
  static displayName = '3D Scene';
  static icon = File3dIcon;
  @field meshes = contains(NumberField);
  @field materials = contains(NumberField);
  @field vertices = contains(NumberField);
  @field triangles = contains(NumberField);
  @field generator = contains(StringField);
}

// Deterministic, prerender-safe silhouette. Returns an SVG path `d` string (no
// angle-bracket markup, so it is content-tag safe) describing the 12 edges of a
// box whose proportions match the model's bounding-box extents. The template
// draws it as real <svg>/<path> elements. This is the whole preview until the
// shaded-PNG job (CS-12401) populates `thumbnailUrl`.
export function silhouettePath(x = 1, y = 1, z = 1): string {
  let max = Math.max(x, y, z, 1e-6);
  let w = x / max;
  let h = y / max;
  let d = z / max;
  let ox = 120;
  let oy = 128;
  let s = 62;
  let project = (px: number, py: number, pz: number): [number, number] => {
    let ax = (px - 0.5) * w;
    let ay = (py - 0.5) * h;
    let az = (pz - 0.5) * d;
    return [ox + (ax - az) * s, oy + (ax + az) * (s / 2) - ay * s];
  };
  let corners: [number, number][] = [
    project(0, 0, 0),
    project(1, 0, 0),
    project(1, 0, 1),
    project(0, 0, 1),
    project(0, 1, 0),
    project(1, 1, 0),
    project(1, 1, 1),
    project(0, 1, 1),
  ];
  let edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  let fmt = (n: number): string => (Math.round(n * 100) / 100).toString();
  return edges
    .map(([a, b]) => {
      let from = corners[a];
      let to = corners[b];
      return `M${fmt(from[0])},${fmt(from[1])}L${fmt(to[0])},${fmt(to[1])}`;
    })
    .join(' ');
}

// Shared hero: the generated PNG (`thumbnailUrl`, populated by CS-12401) when
// present, otherwise the SVG silhouette. Kept as a standalone component so both
// the base and the leaf isolated templates reuse it without duplication.
export class ModelPreview extends GlimmerComponent<{
  Args: { model: ModelDef };
  Element: HTMLElement;
}> {
  get path() {
    let e = this.args.model.extents;
    return silhouettePath(e.x, e.y, e.z);
  }

  <template>
    <div class='model-preview' ...attributes>
      {{#if @model.thumbnailUrl}}
        <img
          class='model-preview__img'
          src={{@model.thumbnailUrl}}
          alt={{@model.name}}
          loading='lazy'
        />
      {{else}}
        <svg
          class='model-preview__svg'
          viewBox='0 0 240 220'
          role='img'
          aria-label={{@model.name}}
        >
          <path
            d={{this.path}}
            fill='rgba(120, 140, 170, 0.10)'
            stroke='currentColor'
            stroke-width='1.25'
            stroke-linejoin='round'
          />
        </svg>
      {{/if}}
    </div>
    <style scoped>
      .model-preview {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        overflow: hidden;
      }
      .model-preview__img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .model-preview__svg {
        width: 80%;
        height: 80%;
        color: var(--boxel-450);
      }
    </style>
  </template>
}

// Generic 3D scene facts rail, styled like the handoff realm's inspector rail.
class ModelSceneRail extends GlimmerComponent<{
  Args: { model: ModelDef };
}> {
  <template>
    <dl class='model-scene'>
      {{#if @model.name}}<div><dt>File</dt><dd>{{@model.name}}</dd></div>{{/if}}
      {{#if @model.model3d.triangles}}<div><dt>Triangles</dt><dd
          >{{@model.model3d.triangles}}</dd></div>{{/if}}
      {{#if @model.model3d.vertices}}<div><dt>Vertices</dt><dd
          >{{@model.model3d.vertices}}</dd></div>{{/if}}
      {{#if @model.model3d.meshes}}<div><dt>Meshes</dt><dd
          >{{@model.model3d.meshes}}</dd></div>{{/if}}
      {{#if @model.model3d.materials}}<div><dt>Materials</dt><dd
          >{{@model.model3d.materials}}</dd></div>{{/if}}
      {{#if @model.model3d.generator}}<div><dt>Generator</dt><dd
          >{{@model.model3d.generator}}</dd></div>{{/if}}
    </dl>
    <style scoped>
      .model-scene {
        margin: 0;
        display: grid;
        gap: 5px;
      }
      .model-scene div {
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
}

// Base isolated body (hero + scene rail). Leaf isolated templates render this,
// then append their format-specific metadata rail after it.
export class ModelIsolatedBody extends GlimmerComponent<{
  Args: { model: ModelDef };
}> {
  <template>
    <div class='model-isolated-body'>
      <div class='model-isolated-body__hero'>
        <ModelPreview @model={{@model}} />
      </div>
      <ModelSceneRail @model={{@model}} />
    </div>
    <style scoped>
      .model-isolated-body {
        display: grid;
        gap: var(--boxel-sp);
      }
      .model-isolated-body__hero {
        aspect-ratio: 4 / 3;
        background: var(--boxel-100);
        border-radius: var(--boxel-border-radius);
        display: grid;
        place-items: center;
      }
    </style>
  </template>
}

class ModelAtomTemplate extends GlimmerComponent<{
  Args: { model: ModelDef };
}> {
  <template>
    <span class='model-atom'>
      <File3dIcon width='16' height='16' />
      <span class='model-atom__name'>{{@model.name}}</span>
    </span>
    <style scoped>
      .model-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }
      .model-atom__name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

class ModelFittedTemplate extends GlimmerComponent<{
  Args: { model: ModelDef };
}> {
  <template>
    <div class='model-fitted'>
      <ModelPreview @model={{@model}} />
    </div>
    <style scoped>
      .model-fitted {
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
    </style>
  </template>
}

class ModelEmbeddedTemplate extends GlimmerComponent<{
  Args: { model: ModelDef };
}> {
  <template>
    <figure class='model-embedded'>
      <div class='model-embedded__hero'>
        <ModelPreview @model={{@model}} />
      </div>
      <figcaption class='model-embedded__caption'>
        <span class='model-embedded__name'>{{@model.name}}</span>
        {{#if @model.model3d.triangles}}
          <small>{{@model.model3d.triangles}} triangles</small>
        {{/if}}
      </figcaption>
    </figure>
    <style scoped>
      .model-embedded {
        margin: 0;
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .model-embedded__hero {
        aspect-ratio: 4 / 3;
        background: var(--boxel-100);
        border-radius: var(--boxel-border-radius);
        display: grid;
        place-items: center;
      }
      .model-embedded__caption {
        display: flex;
        align-items: baseline;
        gap: 10px;
        min-width: 0;
      }
      .model-embedded__name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .model-embedded__caption small {
        color: var(--boxel-450);
        font: 0.5625rem var(--boxel-monospace-font-family, monospace);
      }
    </style>
  </template>
}

class ModelIsolatedTemplate extends GlimmerComponent<{
  Args: { model: ModelDef };
}> {
  <template>
    <section class='model-isolated'>
      <ModelIsolatedBody @model={{@model}} />
    </section>
    <style scoped>
      .model-isolated {
        padding: var(--boxel-sp);
      }
    </style>
  </template>
}

// Base FileDef subclass for 3D model formats. Owns the shared scene metadata,
// the thumbnail seam, and the four format templates. Leaves (StlDef,
// ThreeMfDef) add their format-specific metadata field + extraction and may
// override `isolated` to append that metadata below the shared body.
export class ModelDef extends FileDef {
  static displayName = '3D Model';
  static icon = File3dIcon;

  @field model3d = contains(Model3DInfoField);

  // Convention path for a generated raster preview, populated by CS-12401
  // (shaded-PNG job). Empty in this PR, so the templates render the SVG
  // silhouette. When set, the templates render <img src={{thumbnailUrl}}>.
  @field thumbnailUrl = contains(StringField);

  // Bounding-box extents used to draw the silhouette. Leaves override this to
  // read their own extracted sizes.
  get extents(): { x: number; y: number; z: number } {
    return { x: 1, y: 1, z: 1 };
  }

  static isolated: BaseDefComponent = ModelIsolatedTemplate;
  static embedded: BaseDefComponent = ModelEmbeddedTemplate;
  static fitted: BaseDefComponent = ModelFittedTemplate;
  static atom: BaseDefComponent = ModelAtomTemplate;
}
