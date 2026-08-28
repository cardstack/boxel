// The 3D model family's renderer, projected into the format shells by
// `FilePreviewStage`. Embedded and isolated mount a live WebGL orbit viewer;
// fitted — a collection cell that a grid can show dozens of at once — never
// boots a context and shows the static cube instead.
//
// Three.js is loaded from a CDN (esm.sh) only at live client render time, the
// sanctioned Boxel pattern for external libraries (the loader resolves https://
// specifiers). Two gates keep WebGL off the paths where it can't or shouldn't
// run:
//   - PRERENDER: server-side rendering (indexing/prerender) never boots WebGL or
//     fetches the CDN engine; `isLiveRender()` is the deterministic gate. The
//     static cube is the prerender representation.
//   - VIEWPORT: the viewer boots only while on-screen and disposes its context
//     when scrolled off, re-booting on re-entry — so a strip of embedded models
//     keeps only the visible ones holding a context and never exhausts the
//     browser's ~16-context budget.
//
// Any failure (no WebGL, offline, blocked CDN, unparseable geometry) is caught
// and leaves the cube placeholder in place.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import CubeIcon from '@cardstack/boxel-icons/cube';

import type { FilePreviewSignature } from './file-preview-stage';

// Static preview behind the live viewer and in fitted cells: a plain cube icon.
// A shaded raster thumbnail (CS-12401) will later flow through the shell's own
// thumbnail path rather than here.
class ModelThumbnail extends GlimmerComponent<{
  Args: { name?: string };
  Element: HTMLElement;
}> {
  <template>
    <div class='model-thumb' ...attributes>
      <CubeIcon class='model-thumb__icon' role='img' aria-label={{@name}} />
    </div>
    <style scoped>
      .model-thumb {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        overflow: hidden;
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

const renderModel = modifier(
  (element: HTMLElement, [component, url]: [Model3DPreview, string]) => {
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
            // dimensions we don't extract at index time come from here.
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

export class Model3DPreview extends GlimmerComponent<FilePreviewSignature> {
  @tracked state: 'loading' | 'ready' | 'error' = 'loading';
  @tracked dimensions: { x: number; y: number; z: number } | null = null;

  get isFitted() {
    return this.args.format === 'fitted';
  }
  get url() {
    return String(this.args.model?.resourceUrl ?? this.args.model?.url ?? '');
  }
  get name() {
    return String(this.args.model?.name ?? 'model');
  }
  // The format's own unit labels the dimensions readout (3MF carries one; STL is
  // unitless). Read off the projected `model3d` field.
  get unit() {
    return String(this.args.model?.model3d?.unit ?? '');
  }
  get label() {
    return `Interactive 3D preview of ${this.name}`;
  }
  get isReady() {
    return this.state === 'ready';
  }
  get showHint() {
    return this.isReady;
  }
  // True, transform-correct dimensions from the loaded geometry, labeled with
  // the format's unit when it has one.
  get dimensionsLabel() {
    if (!this.dimensions) {
      return '';
    }
    let unit = this.unit ? ` ${this.unit}` : '';
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
    {{#if this.isFitted}}
      <ModelThumbnail @name={{this.name}} data-test-model-preview='fitted' />
    {{else}}
      <div class='model-viewer' data-test-model-preview={{@format}}>
        {{#if this.url}}
          <div class='model-viewer__host' {{renderModel this this.url}}></div>
        {{/if}}
        {{#unless this.isReady}}
          <div class='model-viewer__placeholder'>
            <ModelThumbnail @name={{this.name}} />
          </div>
        {{/unless}}
        {{#if this.dimensionsLabel}}
          <div class='model-viewer__dims'>{{this.dimensionsLabel}}</div>
        {{/if}}
        {{#if this.showHint}}
          <div class='model-viewer__hint'>Drag to orbit · scroll to zoom</div>
        {{/if}}
      </div>
    {{/if}}
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

export default Model3DPreview;
