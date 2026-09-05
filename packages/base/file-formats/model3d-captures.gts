// The 3D families' declared-screenshot capture: a capture-only WebGL render
// of one still frame so the fitted cell (and the thumbnail fallback chain)
// show the model instead of a cube glyph.
//
// Determinism is the contract (the same guardrails the live viewer's framing
// obeys, minus everything interactive): a fixed default camera direction and
// distance derived only from the model's own bounds, fixed lights, no
// controls, no damping, no animation mixers — one render call, then the
// readiness signal drops. Unchanged bytes byte-hash to the same still across
// reindexes.
//
// three.js loads from the same pinned CDN builds the live orbit viewer uses,
// only inside the capture render.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import { fileResourceURL } from './file-image';

import type { ScreenshotSpec } from '../card-api';

interface CaptureSignature {
  Args: {
    model: any;
  };
  Element: HTMLElement;
}

function extensionOf(name: string): string {
  let dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export class Model3dStillCapture extends GlimmerComponent<CaptureSignature> {
  // The capture engine waits (bounded) for no `data-screenshot-pending`
  // attribute before shooting: the WebGL first frame isn't visible to the
  // engine's image-paint wait, so the component owns the readiness signal.
  @tracked pending = true;

  private renderStill = modifier((element: HTMLElement) => {
    let cancelled = false;
    let renderer: any;
    let finish = () => {
      if (!cancelled) {
        this.pending = false;
      }
    };
    (async () => {
      try {
        let model = this.args.model;
        let url = fileResourceURL(model);
        if (!url) {
          return;
        }
        let extension = extensionOf(String(model?.name ?? url));
        let isThreeMf = extension === '3mf';
        let isStl = extension === 'stl';
        let [THREE, loaderModule] = await Promise.all([
          // @ts-expect-error Pinned browser ESM import; the Boxel loader resolves https:// at runtime
          import('https://esm.sh/three@0.160.0'),
          isThreeMf
            ? // @ts-expect-error Pinned browser ESM import; 3MFLoader brings its own fflate dependency
              import('https://esm.sh/three@0.160.0/examples/jsm/loaders/3MFLoader.js')
            : isStl
              ? // @ts-expect-error Pinned browser ESM import; STLLoader handles ASCII and binary STL
                import('https://esm.sh/three@0.160.0/examples/jsm/loaders/STLLoader.js')
              : // @ts-expect-error Pinned browser ESM import; the Boxel loader resolves https:// at runtime
                import('https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js'),
        ]);
        let response = await fetch(url);
        if (!response.ok) {
          return;
        }
        let bytes = await response.arrayBuffer();
        if (cancelled) {
          return;
        }

        let root: any;
        if (isThreeMf) {
          root = new loaderModule.ThreeMFLoader().parse(bytes);
        } else if (isStl) {
          let geometry = new loaderModule.STLLoader().parse(bytes);
          geometry.computeVertexNormals();
          root = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
              color: 0xb8bec9,
              roughness: 0.55,
              metalness: 0.08,
            }),
          );
        } else {
          let gltf = await new Promise<any>((resolve, reject) =>
            new loaderModule.GLTFLoader().parse(bytes, url, resolve, reject),
          );
          root = gltf.scene;
        }
        if (cancelled) {
          return;
        }

        let box = element.getBoundingClientRect();
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.setSize(box.width, box.height);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        element.appendChild(renderer.domElement);

        let scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x697080, 2.1));
        let key = new THREE.DirectionalLight(0xffffff, 2.4);
        key.position.set(3, 5, 4);
        scene.add(key);
        let fill = new THREE.DirectionalLight(0xaec6ff, 1.1);
        fill.position.set(-4, 1, -2);
        scene.add(fill);

        root.updateMatrixWorld(true);
        let bounds = new THREE.Box3().setFromObject(root);
        if (bounds.isEmpty()) {
          return;
        }
        scene.add(root);
        let size = bounds.getSize(new THREE.Vector3());
        let center = bounds.getCenter(new THREE.Vector3());

        // The live viewer's default framing, with no orbit state to inherit:
        // distance from the bounds and the fixed default direction (flat
        // prints face the camera).
        let camera = new THREE.PerspectiveCamera(
          38,
          box.width / Math.max(box.height, 1),
          0.01,
          100,
        );
        let verticalFov = THREE.MathUtils.degToRad(camera.fov);
        let horizontalFov =
          2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
        let heightDistance = size.y / (2 * Math.tan(verticalFov / 2));
        let widthDistance = size.x / (2 * Math.tan(horizontalFov / 2));
        let distance =
          Math.max(heightDistance, widthDistance, 0.001) * 1.2 + size.z;
        let isFlatPrint =
          size.z < Math.max(0.001, Math.min(size.x, size.y) * 0.35);
        let direction = isFlatPrint
          ? new THREE.Vector3(0.08, -0.14, 1).normalize()
          : new THREE.Vector3(0.72, 0.52, 1).normalize();
        camera.position.copy(center).add(direction.multiplyScalar(distance));
        camera.near = Math.max(0.001, distance / 1000);
        camera.far = Math.max(distance * 10, size.length() * 12, 100);
        camera.lookAt(center);
        camera.updateProjectionMatrix();

        renderer.render(scene, camera);
      } catch {
        // An unparsable model is an absent still, not a broken capture
        // render: readiness resolves either way and the fitted cell keeps
        // its glyph fallback.
      } finally {
        finish();
      }
    })();
    return () => {
      cancelled = true;
      try {
        renderer?.dispose();
      } catch {
        // best-effort teardown of a context that may already be gone
      }
    };
  });

  <template>
    <div
      class='model3d-still-capture'
      data-screenshot-pending={{if this.pending 'true'}}
      {{this.renderStill}}
    >
    </div>
    <style scoped>
      .model3d-still-capture {
        position: absolute;
        inset: 0;
        overflow: hidden;
      }
    </style>
  </template>
}

// The 3D families' declared roster (GLB, glTF, STL, 3MF inherit it from
// ThreeDModelDef): one rendered still at the recommended thumbnail box (the
// CardsGrid tile, 170×250 at the default deviceScaleFactor of 2), keyed on
// file content so a metadata-only edit never re-renders the scene, feeding
// the thumbnail fallback chain and the fitted cell through the view model's
// thumbnail seam.
export const MODEL3D_FAMILY_SCREENSHOTS: Record<string, ScreenshotSpec> = {
  poster: {
    render: Model3dStillCapture,
    width: 170,
    height: 250,
    keyBy: 'file-content',
    useAsThumbnail: true,
  },
};
