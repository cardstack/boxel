import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { eq } from '@cardstack/boxel-ui/helpers';

// Ported from the file-experience prototype's model preview. three.js is loaded
// from a CDN with a runtime dynamic import — the Boxel card runtime resolves it
// natively in the browser, so the viewer works inside the isolated card render
// without any host build wiring. Only STL and 3MF are wired here.

interface Signature {
  Args: {
    url?: string | null;
    fileType: 'stl' | '3mf';
    name?: string;
  };
  Element: HTMLElement;
}

// Release GPU resources for every mesh/material/texture under a root.
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

const renderModel = modifier(
  (
    element: HTMLElement,
    [component, url, fileType]: [ThreeModelViewer, string, 'stl' | '3mf'],
  ) => {
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
    let observer: ResizeObserver | undefined;
    let frameModel: ((resetDirection?: boolean) => void) | undefined;
    let isThreeMf = fileType === '3mf';

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
            // @ts-expect-error Pinned browser ESM import; Boxel resolves it at runtime
            import('https://esm.sh/three@0.160.0'),
            // @ts-expect-error Pinned browser ESM import; Boxel resolves it at runtime
            import('https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js'),
            isThreeMf
              ? // @ts-expect-error Pinned browser ESM import; 3MFLoader brings its own fflate dependency
                import('https://esm.sh/three@0.160.0/examples/jsm/loaders/3MFLoader.js')
              : // @ts-expect-error Pinned browser ESM import; STLLoader handles ASCII + binary STL
                import('https://esm.sh/three@0.160.0/examples/jsm/loaders/STLLoader.js'),
            fetch(url, { credentials: 'include', signal: controller.signal }),
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
        renderer.domElement.setAttribute('role', 'img');
        renderer.domElement.setAttribute(
          'aria-label',
          `Interactive 3D preview of ${component.args.name ?? 'model'}`,
        );
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

        observer = new ResizeObserver(resize);
        observer.observe(element);
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
        } else {
          let loader = new loaderModule.STLLoader();
          let geometry = loader.parse(bytes);
          // Repair valid STL files that store zero facet normals.
          geometry.computeVertexNormals();
          let hasColors = Boolean(
            (geometry as any).hasColors || geometry.getAttribute('color'),
          );
          let material = new THREE.MeshStandardMaterial({
            color: hasColors ? 0xffffff : 0xb9c0cb,
            vertexColors: hasColors,
            roughness: 0.62,
            metalness: 0.08,
            side: THREE.DoubleSide,
          });
          let mesh = new THREE.Mesh(geometry, material);
          // STL is commonly Z-up; convert to the three.js Y-up scene.
          mesh.rotation.x = -Math.PI / 2;
          installModel(mesh);
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
      observer?.disconnect();
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

export default class ThreeModelViewer extends GlimmerComponent<Signature> {
  @tracked state: 'loading' | 'ready' | 'error' = 'loading';
  @tracked errorMessage = '';

  setLoading = () => {
    this.state = 'loading';
    this.errorMessage = '';
  };
  setReady = () => {
    this.state = 'ready';
  };
  setError = (error: unknown) => {
    this.state = 'error';
    this.errorMessage =
      error instanceof Error ? error.message : 'Unable to render model';
  };

  <template>
    <div class='model-preview' data-state={{this.state}} data-test-three-viewer>
      {{#if @url}}
        <div
          class='model-host'
          {{renderModel this @url @fileType}}
          data-test-three-canvas
        ></div>
        {{#if (eq this.state 'loading')}}
          <div class='model-status' data-test-three-loading>Loading 3D scene…</div>
        {{/if}}
        {{#if (eq this.state 'error')}}
          <div class='model-status model-error' data-test-three-error>
            {{this.errorMessage}}
          </div>
        {{/if}}
        <div class='model-hint'>Drag to orbit · scroll to zoom · double-click to
          reset</div>
      {{else}}
        <div class='model-status' data-test-three-fallback>Model source
          unavailable</div>
      {{/if}}
    </div>

    <style scoped>
      .model-preview {
        position: relative;
        width: 100%;
        min-height: 360px;
        overflow: hidden;
        border-radius: var(--boxel-radius-sm);
        background: var(--boxel-100);
      }

      .model-host {
        position: absolute;
        inset: 0;
      }

      .model-host :deep(canvas) {
        display: block;
        width: 100%;
        height: 100%;
        cursor: grab;
        touch-action: none;
      }

      .model-host :deep(canvas:active) {
        cursor: grabbing;
      }

      .model-status {
        position: absolute;
        inset: 50% auto auto 50%;
        transform: translate(-50%, -50%);
        max-width: 80%;
        text-align: center;
        z-index: 2;
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
        background: color-mix(in srgb, var(--boxel-light) 84%, transparent);
        border-radius: 3px;
        padding: 4px 7px;
        pointer-events: none;
      }

      .model-error {
        color: var(--boxel-danger, #b00);
      }

      .model-hint {
        position: absolute;
        right: 8px;
        bottom: 8px;
        z-index: 2;
        color: var(--boxel-600);
        font-size: var(--boxel-font-xs);
        background: color-mix(in srgb, var(--boxel-light) 84%, transparent);
        border-radius: 3px;
        padding: 4px 7px;
        pointer-events: none;
      }
    </style>
  </template>
}
