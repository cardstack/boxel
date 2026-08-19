import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { modifier } from 'ember-modifier';
// @ts-expect-error esm.run is a runtime import; TS can't resolve it
import * as THREE from 'https://esm.run/three@0.169.0';

// 🧩 PATTERN: Three.js inside a card via ESM CDN, with modifier-based cleanup.

interface SceneConfig {
  cubeColor: string;
  rotate: boolean;
}

const threeSceneModifier = modifier(
  (element: HTMLElement, [config]: [SceneConfig]) => {
    // === Setup ========================================================
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(element.clientWidth, element.clientHeight);
    renderer.setClearColor(0x111111);
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      element.clientWidth / element.clientHeight,
      0.1,
      1000,
    );
    camera.position.z = 3;

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: config.cubeColor });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(5, 5, 5);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    // === Resize handling ==============================================
    const onResize = () => {
      renderer.setSize(element.clientWidth, element.clientHeight);
      camera.aspect = element.clientWidth / element.clientHeight;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(element);

    // === Animation loop ===============================================
    let frameId: number;
    const tick = () => {
      if (config.rotate) {
        cube.rotation.x += 0.01;
        cube.rotation.y += 0.01;
      }
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(tick);
    };
    tick();

    // === Cleanup (CRITICAL) ===========================================
    return () => {
      cancelAnimationFrame(frameId);
      ro.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  },
);

// === The CardDef ======================================================

export class SpinningCubeCard extends CardDef {
  static displayName = 'Spinning Cube';

  @field cubeColor = contains(StringField); // e.g. '#7b61ff'

  static isolated = class extends Component<typeof SpinningCubeCard> {
    get config(): SceneConfig {
      return {
        cubeColor: this.args.model.cubeColor ?? '#7b61ff',
        rotate: true,
      };
    }

    <template>
      <div class='three-host' {{threeSceneModifier this.config}}></div>

      <style scoped>
        .three-host {
          width: 100%;
          height: 500px;       /* Three.js needs explicit dimensions */
          border-radius: var(--radius, 8px);
          overflow: hidden;
        }
      </style>
    </template>
  };
}
