---
validated: source-proven
---

# integrate-three-js-via-cdn — Three.js inside a card, loaded from ESM CDN

**What this gives you:** A working WebGL scene (cube, model, particle field, anything Three.js can render) inside a Boxel card's `isolated` template — without a build step, without adding Three.js to the realm bundle.

**When to use:** 3D viewers, hero animations, data visualizations that exceed what CSS/SVG can do, immersive product showcases. Anywhere you'd reach for a custom WebGL surface.

**The insight:** Boxel cards can `import * as THREE from 'https://esm.run/three'` — the realm server doesn't care, and esm.run rewrites the import graph for direct browser ESM. The trick is **lifecycle management**: Three.js mutates global WebGL state, creates DOM elements, attaches resize listeners. You MUST clean up on teardown or you leak GPU memory across re-renders. Use a Glimmer modifier on the canvas `<div>` so Boxel's lifecycle calls your cleanup.

**Recipe shape:**

```ts
import { modifier } from 'ember-modifier';
import * as THREE from 'https://esm.run/three';

const threeSceneModifier = modifier(
  (element: HTMLElement, [config]: [{ rotate?: boolean }]) => {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(element.clientWidth, element.clientHeight);
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, element.clientWidth / element.clientHeight, 0.1, 1000);
    // … set up scene, lights, geometries …

    let frameId: number;
    const tick = () => {
      // animate
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      // 🎯 Critical cleanup:
      cancelAnimationFrame(frameId);
      renderer.dispose();
      element.removeChild(renderer.domElement);
      // dispose any geometries/materials/textures you allocated
    };
  },
);
```

Apply the modifier on a sized `<div>` in the template: `<div class='three-host' {{threeSceneModifier this.config}}></div>`.

**Gotchas:**
- **Container must have width and height.** Three.js can't render into a zero-sized element. Set explicit dimensions on the host div.
- **Cleanup is mandatory.** Every `geometry.dispose()`, `material.dispose()`, `texture.dispose()`, and `renderer.dispose()` matters — and you must remove the canvas from the DOM. Leaks compound across card re-renders.
- **Version pinning is by URL.** `https://esm.run/three` follows latest. To pin: `https://esm.run/three@0.169.0`. Document the chosen version in a comment so it doesn't drift silently.
- **Resize is your problem.** Listen to ResizeObserver on the host element and call `renderer.setSize()` + `camera.aspect = …` + `camera.updateProjectionMatrix()`.
- **Animation loops fight ember-concurrency.** Don't `await` inside the tick — use `requestAnimationFrame` recursion only.

**Same modifier shape covers Babylon.js and raw WebGL.** The Glimmer-modifier + cleanup pattern above is general — swap `import * as THREE from '...'` for `import * as BABYLON from 'https://esm.run/@babylonjs/core'` or replace the scene-construction body with raw `gl = canvas.getContext('webgl2')` + shader compilation. Cleanup remains identical: cancel RAF, dispose of GL resources (programs, buffers, textures), remove the canvas from the DOM. Sources to look for in the workspace: `shader-demo.gts` (raw WebGL shader card) and `3d-product-viewer.gts` (Babylon-flavored alternative).

**Source:** Catalog-realm and several realms use this pattern. BSL-STUDY V1 cites `chess/chess.gts` (similar approach with chess.js + cm-chessboard) and `gltf-viewer.gts` as the canonical references.

**See also:** `integrate-leaflet-via-cdn`, `integrate-chess-js-via-cdn`, `integrate-tone-js-via-cdn` (audio sibling — same lifecycle shape), `integrate-web-audio-synthesis` (raw-API sibling), `boxel/references/external-libraries.md` (the general async-load + modifier pattern).
