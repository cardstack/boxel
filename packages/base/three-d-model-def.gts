import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import CubeIcon from '@cardstack/boxel-icons/cube';
import File3dIcon from '@cardstack/boxel-icons/file-3d';
import {
  BaseDefComponent,
  FileDef,
  StringField,
  contains,
  field,
} from './card-api';

// Extracted to a module const: a regex literal inline in a `.gts` (with `/`
// inside a character class) can confuse the content-tag template lexer.
const EXTENSION_RE = new RegExp('\\.[^/.]+$');

// Lowercased file extension (including the leading dot) from a URL, e.g.
// `.stl`. Shared by the leaf `extractAttributes` methods to reject a file whose
// bytes don't match its extension. Falls back to a plain string scan when the
// value isn't a parseable URL.
export function getExtension(url: string): string {
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

// Static preview: the generated PNG (`thumbnailUrl`, populated by CS-12401) when
// present, otherwise a plain cube icon. Used by fitted (which never boots a
// viewer) and as the placeholder behind the live WebGL viewer. Deliberately not
// a silhouette drawn from index-time bounds — those are gone; the real preview
// is a shaded thumbnail (CS-12401) and the interactive shape is the live viewer.
export class ModelThumbnail extends GlimmerComponent<{
  Args: { model: ThreeDModelDef };
  Element: HTMLElement;
}> {
  <template>
    <div class='model-thumb' ...attributes>
      {{#if @model.thumbnailUrl}}
        <img
          class='model-thumb__img'
          src={{@model.thumbnailUrl}}
          alt={{@model.name}}
          loading='lazy'
        />
      {{else}}
        <CubeIcon
          class='model-thumb__icon'
          role='img'
          aria-label={{@model.name}}
        />
      {{/if}}
    </div>
    <style scoped>
      .model-thumb {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        overflow: hidden;
      }
      .model-thumb__img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .model-thumb__icon {
        width: 45%;
        height: 45%;
        max-width: 96px;
        max-height: 96px;
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

// Base cards read this global to tell a server-side prerender from a live
// client render (same signal `query-field-support` / `links-to-many` use).
function isLiveRender(): boolean {
  return !(globalThis as { __boxelRenderContext?: unknown })
    .__boxelRenderContext;
}

// Authenticated fetch of the file bytes + a Three.js orbit scene, loaded from a
// CDN (esm.run/esm.sh) only at live client render time — the sanctioned Boxel
// card pattern for external libraries (the loader resolves https:// specifiers).
//
// Two gates keep WebGL off the paths where it can't or shouldn't run:
//   - PRERENDER: server-side rendering (indexing/prerender) never boots WebGL or
//     fetches the CDN engine. The static thumbnail is the prerender
//     representation; `isLiveRender()` is the deterministic gate (rather than
//     relying on a doomed CDN import failing).
//   - VIEWPORT: the viewer boots only while the element is on-screen and
//     disposes its WebGL context when scrolled off, re-booting on re-entry. So a
//     strip of embedded models keeps only the visible ones holding a context and
//     never exhausts the browser's ~16-context budget. (Fitted, a many-tile
//     grid that can show more than that at once, uses the thumbnail instead —
//     see ModelFittedTemplate; a pooled renderer for live fitted is CS-12401.)
//
// Any failure (no WebGL, offline, blocked CDN, unparseable geometry) is caught
// and leaves the thumbnail placeholder in place.
const renderModel = modifier(
  (element: HTMLElement, [component, url]: [ModelViewer, string]) => {
    if (!url || !isLiveRender()) {
      return;
    }
    let cancelled = false;
    let frameId = 0;
    // Model bytes are fetched once and reused across dispose/re-boot cycles, so
    // scrolling a tile in and out doesn't re-download it.
    let cachedBytes: ArrayBuffer | undefined;
    let controller: AbortController | undefined;
    let renderer: any;
    let scene: any;
    let camera: any;
    let controls: any;
    let modelRoot: any;
    let frameModel: ((resetDirection?: boolean) => void) | undefined;
    let booted = false;
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
    let resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element);

    let tick = () => {
      if (cancelled || !renderer || !scene || !camera) {
        return;
      }
      controls.update();
      renderer.render(scene, camera);
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- WebGL paint loop owns no Ember state
      frameId = requestAnimationFrame(tick);
    };

    // Release the WebGL context and scene when the tile leaves the viewport (or
    // on teardown). Re-entry calls `boot()` again, which rebuilds from the
    // cached bytes.
    let disposeGl = () => {
      cancelAnimationFrame(frameId);
      frameId = 0;
      controller?.abort();
      controls?.dispose?.();
      disposeObject(modelRoot);
      renderer?.dispose?.();
      renderer?.forceContextLoss?.();
      renderer?.domElement?.remove();
      renderer = scene = camera = controls = modelRoot = undefined;
      frameModel = undefined;
      booted = false;
      // Back to the thumbnail. Skip during teardown — the component is going
      // away and must not have tracked state mutated mid-destroy.
      if (!cancelled) {
        component.setLoading();
      }
    };

    let boot = () => {
      if (booted || cancelled) {
        return;
      }
      booted = true;
      component.setLoading();
      let localController = new AbortController();
      controller = localController;
      void (async () => {
        try {
          let [THREE, controlsModule, loaderModule] = await Promise.all([
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
          ]);
          let bytes = cachedBytes;
          if (!bytes) {
            // No `credentials: 'include'` — that makes a credentialed CORS
            // request, illegal against the realm's wildcard
            // `Access-Control-Allow-Origin`. The host auth service worker
            // injects the realm `Authorization` header on this GET (same path
            // that lets <img src> load realm images).
            let response = await fetch(url, { signal: localController.signal });
            if (!response.ok) {
              throw new Error(
                `Model fetch failed with HTTP ${response.status}`,
              );
            }
            bytes = await response.arrayBuffer();
            cachedBytes = bytes;
          }
          // Disposed (scrolled off) or torn down while loading — bail before
          // creating a context.
          if (cancelled || !booted) {
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
            if (cancelled || !booted) {
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
            // Report the true, transform-correct bounding box for display — the
            // dimensions we no longer extract at index time come from here.
            component.setDimensions(size);
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
          if (!cancelled && booted) {
            component.setError(error);
          }
        }
      })();
    };

    // Boot while on-screen, dispose when scrolled off — so only visible viewers
    // hold a WebGL context.
    let visibilityObserver = new IntersectionObserver((entries) => {
      if (cancelled) {
        return;
      }
      if (entries.some((entry) => entry.isIntersecting)) {
        boot();
      } else {
        disposeGl();
      }
    });
    visibilityObserver.observe(element);

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
      visibilityObserver.disconnect();
      resizeObserver.disconnect();
      disposeGl();
      for (let eventName of ['pointerdown', 'pointerup', 'click', 'wheel']) {
        element.removeEventListener(eventName, stop);
      }
      element.removeEventListener('dblclick', resetView);
    };
  },
);

// Live WebGL orbit viewer used by embedded + isolated. The static thumbnail
// (ModelThumbnail) shows until the scene paints, and remains whenever WebGL
// isn't running: server-side prerender (the modifier no-ops there) and while a
// tile is scrolled off-screen (the modifier disposes its context). Fitted does
// NOT use this — a grid can show more tiles than the browser's WebGL context
// budget at once, so it stays on the thumbnail (pooled-renderer live fitted is
// CS-12401).
export class ModelViewer extends GlimmerComponent<{
  Args: { model: ThreeDModelDef; unit?: string };
  Element: HTMLElement;
}> {
  @tracked state: 'loading' | 'ready' | 'error' = 'loading';
  @tracked dimensions: { x: number; y: number; z: number } | null = null;

  get url() {
    return this.args.model.url;
  }
  get label() {
    return `Interactive 3D preview of ${this.args.model.name ?? 'model'}`;
  }
  get isReady() {
    return this.state === 'ready';
  }
  get showHint() {
    return this.isReady;
  }
  // True, transform-correct dimensions from the loaded geometry, labeled with
  // the format's unit when it has one (3MF); STL is unitless.
  get dimensionsLabel() {
    if (!this.dimensions) {
      return '';
    }
    let unit = this.args.unit ? ` ${this.args.unit}` : '';
    return `${this.dimensions.x} × ${this.dimensions.y} × ${this.dimensions.z}${unit}`;
  }
  setLoading = () => {
    this.state = 'loading';
    this.dimensions = null;
  };
  setReady = () => {
    this.state = 'ready';
  };
  setError = (_error: unknown) => {
    this.state = 'error';
  };
  setDimensions = (size: { x: number; y: number; z: number }) => {
    let round = (n: number) => Math.round(n * 100) / 100;
    this.dimensions = { x: round(size.x), y: round(size.y), z: round(size.z) };
  };

  <template>
    <div class='model-viewer' ...attributes>
      {{#if this.url}}
        <div class='model-viewer__host' {{renderModel this this.url}}></div>
      {{/if}}
      {{#unless this.isReady}}
        <div class='model-viewer__placeholder'>
          <ModelThumbnail @model={{@model}} />
        </div>
      {{/unless}}
      {{#if this.dimensionsLabel}}
        <div class='model-viewer__dims'>{{this.dimensionsLabel}}</div>
      {{/if}}
      {{#if this.showHint}}
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
      .model-viewer__dims {
        position: absolute;
        left: 0.5rem;
        bottom: 0.5rem;
        padding: 0.25rem 0.4375rem;
        border-radius: 0.1875rem;
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: 0.5625rem;
        letter-spacing: 0.02em;
        color: var(--muted-foreground);
        background: color-mix(in srgb, var(--card) 84%, transparent);
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

export interface ModelInspectorRow {
  term: string;
  detail: string | number;
}

// One titled group of term/detail rows in the isolated inspector. Owns the row
// markup AND its scoped styles, so the three isolated templates (the shared 3D
// facts here plus each leaf's format-specific group) don't each re-declare the
// same ~40 lines of CSS. glimmer scoped-css scopes to the component that authors
// the markup and can't be shared through a yielded block — so to share the
// styles the section has to own the markup, which means it's data-driven
// (`@rows`) rather than a wrapper around a yielded block. Callers build the rows
// array, omitting values they don't want to show.
export class ModelInspectorSection extends GlimmerComponent<{
  Args: { heading: string; rows: ModelInspectorRow[] };
}> {
  <template>
    <section class='insp-group'>
      <h2 class='insp-head'>{{@heading}}</h2>
      <dl class='insp-rows'>
        {{#each @rows as |row|}}
          <div><dt>{{row.term}}</dt><dd>{{row.detail}}</dd></div>
        {{/each}}
      </dl>
    </section>
    <style scoped>
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

// Full isolated work surface, mirroring the handoff realm: a header bar
// (icon + name + extension pill) over a two-column body — a bordered live-viewer
// stage on the left and a property inspector on the right. The leaf isolated
// templates render this and pass their format-specific metadata group into the
// inspector via the default block.
export class ModelIsolatedBody extends GlimmerComponent<{
  Args: { model: ThreeDModelDef };
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
            <ModelViewer @model={{@model}} @unit={{@model.displayUnit}} />
          </div>
        </section>

        <aside class='inspector'>
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
        /* Uniform spacing between inspector groups (each leaf's yielded
           ModelInspectorSection) — replaces the old per-group margin, which
           can't reach across component boundaries once each group is its own
           scoped-css component. */
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
      }
    </style>
  </template>
}

class ModelAtomTemplate extends GlimmerComponent<{
  Args: { model: ThreeDModelDef };
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

// Fitted is the collection-tile format. It shows a static cube icon (or the
// CS-12401 thumbnail once present) plus the file name — mirroring the audio
// FileDef's fitted tile. It intentionally does NOT mount the live viewer: a grid
// of many tiles would otherwise boot one WebGL context per tile and exhaust the
// browser's context budget.
class ModelFittedTemplate extends GlimmerComponent<{
  Args: { model: ThreeDModelDef };
}> {
  <template>
    <div class='model-fitted'>
      <div class='model-fitted__thumb'>
        <ModelThumbnail @model={{@model}} />
      </div>
      <span class='model-fitted__name'>{{@model.name}}</span>
    </div>
    <style scoped>
      .model-fitted {
        container-name: fitted-card;
        container-type: size;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        overflow: hidden;
      }
      .model-fitted__thumb {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
      }
      .model-fitted__name {
        min-width: 0;
        font-weight: 600;
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      /* Portrait/large tiles: stack the thumbnail over the name and let the
         thumbnail grow. */
      @container fitted-card (aspect-ratio <= 1.0) and (height >= 120px) {
        .model-fitted {
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }
        .model-fitted__thumb {
          width: 60%;
          height: auto;
          aspect-ratio: 1;
          max-width: 140px;
        }
      }
    </style>
  </template>
}

class ModelEmbeddedTemplate extends GlimmerComponent<{
  Args: { model: ThreeDModelDef };
}> {
  <template>
    <figure class='model-embedded'>
      <div class='model-embedded__hero'>
        <ModelViewer @model={{@model}} @unit={{@model.displayUnit}} />
      </div>
      <figcaption class='model-embedded__caption'>
        <span class='model-embedded__name'>{{@model.name}}</span>
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
    </style>
  </template>
}

class ModelIsolatedTemplate extends GlimmerComponent<{
  Args: { model: ThreeDModelDef };
}> {
  <template><ModelIsolatedBody @model={{@model}} /></template>
}

// Base FileDef subclass for 3D model formats. Owns the thumbnail seam and the
// four format templates. Leaves (StlDef, ThreeMfDef) add their format-specific
// metadata field + extraction and may override `isolated` to append that
// metadata below the shared body, and `displayUnit` to label client-side
// dimensions.
export class ThreeDModelDef extends FileDef {
  static displayName = '3D Model';
  static icon = File3dIcon;

  // Convention path for a generated raster preview, populated by CS-12401
  // (shaded-PNG job). Empty for now, so previews fall back to the cube icon.
  @field thumbnailUrl = contains(StringField);

  // Unit label for the client-side dimensions readout. Leaves override when the
  // format carries a unit (3MF); STL is unitless.
  get displayUnit(): string {
    return '';
  }

  static isolated: BaseDefComponent = ModelIsolatedTemplate;
  static embedded: BaseDefComponent = ModelEmbeddedTemplate;
  static fitted: BaseDefComponent = ModelFittedTemplate;
  static atom: BaseDefComponent = ModelAtomTemplate;
}
