import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
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

// Extracted to a module const: a regex literal inline in a `.gts` (with `/`
// inside a character class) can confuse the content-tag template lexer.
const EXTENSION_RE = new RegExp('\\.[^/.]+$');

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
// draws it as real <svg>/<path> elements. Used by fitted, and as the
// loading/fallback placeholder behind the live viewer in embedded/isolated.
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

// Shared preview: the generated PNG (`thumbnailUrl`, populated by CS-12401)
// when present, otherwise the SVG silhouette. Used directly by fitted and as
// the placeholder behind the live WebGL viewer.
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

// Release GPU resources held by a loaded model when the card leaves the DOM.
function disposeObject(root: any) {
  root?.traverse?.((node: any) => {
    node.geometry?.dispose?.();
    let materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    for (let material of materials.filter(Boolean)) {
      for (let value of Object.values(material)) {
        if ((value as any)?.isTexture) {
          (value as any).dispose();
        }
      }
      material.dispose?.();
    }
  });
}

// Authenticated fetch of the file bytes + a Three.js orbit scene, loaded from a
// CDN (esm.run/esm.sh) only at client render time — the sanctioned Boxel card
// pattern for external libraries (the loader resolves https:// specifiers). The
// engine is never imported during extraction/indexing, so the prerender stays
// pure-JS + silhouette. Any failure (no WebGL, offline, blocked CDN, unparseable
// geometry) is caught and leaves the silhouette placeholder in place.
const renderModel = modifier(
  (element: HTMLElement, [component, url]: [ModelViewer, string]) => {
    if (!url) {
      return;
    }
    let cancelled = false;
    let frameId = 0;
    let controller = new AbortController();
    let renderer: any;
    let scene: any;
    let camera: any;
    let controls: any;
    let modelRoot: any;
    let frameModel: ((resetDirection?: boolean) => void) | undefined;
    let isThreeMf = /\.3mf(?:$|[?#])/i.test(url);
    let isStl = /\.stl(?:$|[?#])/i.test(url);

    let resize = () => {
      if (!renderer || !camera) {
        return;
      }
      let width = Math.max(1, element.clientWidth);
      let height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      frameModel?.(false);
    };
    let observer = new ResizeObserver(resize);
    observer.observe(element);

    let tick = () => {
      if (cancelled || !renderer || !scene || !camera) {
        return;
      }
      controls.update();
      renderer.render(scene, camera);
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- WebGL paint loop owns no Ember state
      frameId = requestAnimationFrame(tick);
    };

    component.setLoading();
    void (async () => {
      try {
        let [THREE, controlsModule, loaderModule, response] = await Promise.all(
          [
            // @ts-expect-error Pinned browser ESM import; the Boxel loader resolves https:// at runtime
            import('https://esm.sh/three@0.160.0'),
            // @ts-expect-error Pinned browser ESM import; the Boxel loader resolves https:// at runtime
            import('https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js'),
            isThreeMf
              ? // @ts-expect-error Pinned browser ESM import; 3MFLoader brings its own fflate dependency
                import('https://esm.sh/three@0.160.0/examples/jsm/loaders/3MFLoader.js')
              : isStl
                ? // @ts-expect-error Pinned browser ESM import; STLLoader handles ASCII and binary STL
                  import('https://esm.sh/three@0.160.0/examples/jsm/loaders/STLLoader.js')
                : // @ts-expect-error Pinned browser ESM import; the Boxel loader resolves https:// at runtime
                  import('https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js'),
            // No `credentials: 'include'` — that makes a credentialed CORS
            // request, illegal against the realm's wildcard
            // `Access-Control-Allow-Origin`. The host auth service worker
            // injects the realm `Authorization` header on this GET (same path
            // that lets <img src> load realm images).
            fetch(url, { signal: controller.signal }),
          ],
        );
        if (!response.ok) {
          throw new Error(`Model fetch failed with HTTP ${response.status}`);
        }
        let bytes = await response.arrayBuffer();
        if (cancelled) {
          return;
        }
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
        controls = new controlsModule.OrbitControls(
          camera,
          renderer.domElement,
        );
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.domElement.setAttribute('aria-label', component.label);
        renderer.domElement.setAttribute('role', 'img');
        element.appendChild(renderer.domElement);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x697080, 2.1));
        let key = new THREE.DirectionalLight(0xffffff, 2.4);
        key.position.set(3, 5, 4);
        scene.add(key);
        let fill = new THREE.DirectionalLight(0xaec6ff, 1.1);
        fill.position.set(-4, 1, -2);
        scene.add(fill);
        controls.enableDamping = true;
        controls.dampingFactor = 0.07;
        controls.enablePan = false;
        controls.autoRotate = false;
        resize();
        tick();

        let installModel = (root: any) => {
          if (cancelled) {
            disposeObject(root);
            return;
          }
          modelRoot = root;
          modelRoot.updateMatrixWorld(true);
          let bounds = new THREE.Box3().setFromObject(modelRoot);
          if (bounds.isEmpty()) {
            throw new Error('Model contains no renderable geometry');
          }
          scene.add(modelRoot);
          let size = bounds.getSize(new THREE.Vector3());
          let center = bounds.getCenter(new THREE.Vector3());
          frameModel = (resetDirection = false) => {
            let verticalFov = THREE.MathUtils.degToRad(camera.fov);
            let horizontalFov =
              2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
            let heightDistance = size.y / (2 * Math.tan(verticalFov / 2));
            let widthDistance = size.x / (2 * Math.tan(horizontalFov / 2));
            let distance =
              Math.max(heightDistance, widthDistance, 0.001) * 1.2 + size.z;
            let isFlatPrint =
              size.z < Math.max(0.001, Math.min(size.x, size.y) * 0.35);
            let defaultDirection = isFlatPrint
              ? new THREE.Vector3(0.08, -0.14, 1).normalize()
              : new THREE.Vector3(0.72, 0.52, 1).normalize();
            let direction = resetDirection
              ? defaultDirection
              : new THREE.Vector3()
                  .subVectors(camera.position, controls.target)
                  .normalize();
            if (
              !Number.isFinite(direction.lengthSq()) ||
              direction.lengthSq() === 0
            ) {
              direction.copy(defaultDirection);
            }
            controls.target.copy(center);
            camera.position
              .copy(center)
              .add(direction.multiplyScalar(distance));
            camera.near = Math.max(0.001, distance / 1000);
            camera.far = Math.max(distance * 10, size.length() * 12, 100);
            camera.updateProjectionMatrix();
            controls.minDistance = Math.max(0.001, distance * 0.18);
            controls.maxDistance = Math.max(distance * 6, size.length() * 8);
            controls.update();
          };
          frameModel(true);
          renderer.render(scene, camera);
          component.setReady();
        };

        if (isThreeMf) {
          let loader = new loaderModule.ThreeMFLoader();
          installModel(loader.parse(bytes));
        } else if (isStl) {
          let loader = new loaderModule.STLLoader();
          let geometry = loader.parse(bytes);
          geometry.computeVertexNormals();
          let hasColors = Boolean(
            (geometry as any).hasColors || geometry.getAttribute('color'),
          );
          let alpha = Number((geometry as any).alpha ?? 1);
          let material = new THREE.MeshStandardMaterial({
            color: hasColors ? 0xffffff : 0xb9c0cb,
            vertexColors: hasColors,
            roughness: 0.62,
            metalness: 0.08,
            opacity: alpha,
            transparent: alpha < 1,
            side: THREE.DoubleSide,
          });
          let mesh = new THREE.Mesh(geometry, material);
          mesh.rotation.x = -Math.PI / 2;
          installModel(mesh);
        } else {
          let loader = new loaderModule.GLTFLoader();
          loader.parse(
            bytes,
            '',
            (gltf: any) => installModel(gltf.scene),
            (error: unknown) => component.setError(error),
          );
        }
      } catch (error) {
        if (!cancelled) {
          component.setError(error);
        }
      }
    })();

    let stop = (event: Event) => event.stopPropagation();
    let resetView = (event: Event) => {
      event.stopPropagation();
      frameModel?.(true);
    };
    for (let eventName of ['pointerdown', 'pointerup', 'click', 'wheel']) {
      element.addEventListener(eventName, stop);
    }
    element.addEventListener('dblclick', resetView);

    return () => {
      cancelled = true;
      controller.abort();
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls?.dispose?.();
      disposeObject(modelRoot);
      renderer?.dispose?.();
      renderer?.forceContextLoss?.();
      renderer?.domElement?.remove();
      for (let eventName of ['pointerdown', 'pointerup', 'click', 'wheel']) {
        element.removeEventListener(eventName, stop);
      }
      element.removeEventListener('dblclick', resetView);
    };
  },
);

// Live WebGL orbit viewer used by embedded + isolated. The silhouette
// (ModelPreview) shows until the scene paints and remains as the fallback if
// WebGL/the CDN engine is unavailable (e.g. during prerender).
export class ModelViewer extends GlimmerComponent<{
  Args: { model: ModelDef };
  Element: HTMLElement;
}> {
  @tracked state: 'loading' | 'ready' | 'error' = 'loading';

  get url() {
    return this.args.model.url;
  }
  get label() {
    return `Interactive 3D preview of ${this.args.model.name ?? 'model'}`;
  }
  get isReady() {
    return this.state === 'ready';
  }
  setLoading = () => {
    this.state = 'loading';
  };
  setReady = () => {
    this.state = 'ready';
  };
  setError = (_error: unknown) => {
    this.state = 'error';
  };

  <template>
    <div class='model-viewer' ...attributes>
      {{#if this.url}}
        <div class='model-viewer__host' {{renderModel this this.url}}></div>
      {{/if}}
      {{#unless this.isReady}}
        <div class='model-viewer__placeholder'>
          <ModelPreview @model={{@model}} />
        </div>
      {{/unless}}
      {{#if this.isReady}}
        <div class='model-viewer__hint'>Drag to orbit · scroll to zoom</div>
      {{/if}}
    </div>
    <style scoped>
      .model-viewer {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: radial-gradient(
          120% 100% at 50% 12%,
          var(--card),
          var(--muted)
        );
      }
      .model-viewer__host {
        position: absolute;
        inset: 0;
      }
      .model-viewer__host :deep(canvas) {
        display: block;
        width: 100%;
        height: 100%;
        cursor: grab;
        touch-action: none;
      }
      .model-viewer__host :deep(canvas:active) {
        cursor: grabbing;
      }
      .model-viewer__placeholder {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        pointer-events: none;
      }
      .model-viewer__hint {
        position: absolute;
        right: 0.5rem;
        bottom: 0.5rem;
        padding: 0.25rem 0.4375rem;
        border-radius: 0.1875rem;
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: 0.5625rem;
        letter-spacing: 0.04em;
        color: var(--muted-foreground);
        background: color-mix(in srgb, var(--card) 84%, transparent);
        pointer-events: none;
      }
    </style>
  </template>
}

// Full isolated work surface, mirroring the handoff realm: a header bar
// (icon + name + extension pill) over a two-column body — a bordered live-viewer
// stage on the left and a property inspector on the right. The leaf isolated
// templates render this and pass their format-specific metadata group into the
// inspector via the default block.
export class ModelIsolatedBody extends GlimmerComponent<{
  Args: { model: ModelDef };
  Blocks: { default: [] };
}> {
  get name() {
    return this.args.model.name ?? '';
  }
  get baseName() {
    return this.name.replace(EXTENSION_RE, '') || this.name;
  }
  get extension() {
    let parts = this.name.split('.');
    return parts.length > 1 ? (parts.pop() ?? '') : '';
  }

  <template>
    <article class='iso'>
      <header class='iso-bar'>
        <File3dIcon
          class='iso-icon'
          width='19'
          height='19'
          aria-hidden='true'
        />
        <h1 class='iso-name'>{{this.baseName}}</h1>
        {{#if this.extension}}
          <span class='ext-pill'>.{{this.extension}}</span>
        {{/if}}
      </header>

      <div class='iso-cols'>
        <section class='iso-stage-region' aria-label='Preview'>
          <div class='iso-stage'>
            <ModelViewer @model={{@model}} />
          </div>
        </section>

        <aside class='inspector'>
          <section class='insp-group'>
            <h2 class='insp-head'>3D model</h2>
            <dl class='insp-rows'>
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
          </section>
          {{yield}}
        </aside>
      </div>
    </article>
    <style scoped>
      .iso {
        padding: var(--boxel-sp-lg);
        color: var(--foreground);
        display: flex;
        flex-direction: column;
        gap: 1rem;
        container-type: inline-size;
      }
      .iso-bar {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        min-width: 0;
        flex-wrap: wrap;
      }
      .iso-icon {
        flex-shrink: 0;
      }
      .iso-name {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ext-pill {
        flex-shrink: 0;
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        color: var(--background);
        background: var(--foreground);
        padding: 0.1875rem 0.5rem;
        border-radius: 0.25rem;
      }
      .iso-cols {
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(17.5rem, 1fr);
        gap: 1.25rem;
        align-items: start;
      }
      @container (max-width: 47.5rem) {
        .iso-cols {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .iso-stage {
        position: relative;
        height: 23.75rem;
        border: 1px solid var(--border);
        border-radius: var(--radius, var(--boxel-border-radius));
        overflow: hidden;
      }
      .inspector {
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius, var(--boxel-border-radius));
        background: var(--card);
        padding: 0.875rem 1rem;
      }
      .insp-group + .insp-group {
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

// Fitted is the collection-tile budget format: silhouette only, never mounts a
// WebGL engine.
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
        <ModelViewer @model={{@model}} />
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
        position: relative;
        aspect-ratio: 4 / 3;
        background: var(--muted);
        border-radius: var(--radius, var(--boxel-border-radius));
        overflow: hidden;
      }
      .model-embedded__caption {
        display: flex;
        align-items: baseline;
        gap: 0.625rem;
        min-width: 0;
      }
      .model-embedded__name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .model-embedded__caption small {
        color: var(--muted-foreground);
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: 0.5625rem;
      }
    </style>
  </template>
}

class ModelIsolatedTemplate extends GlimmerComponent<{
  Args: { model: ModelDef };
}> {
  <template><ModelIsolatedBody @model={{@model}} /></template>
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
  // (shaded-PNG job). Empty in this PR, so fitted renders the SVG silhouette.
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
