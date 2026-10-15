import { loadThree } from '@cardstack/boxel-host/lib/three-loader';
import type * as THREE from 'three';
import type { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** the parts of the host's three.js the gallery's 3D stages build with */
export interface Three {
  DRACOLoader: typeof DRACOLoader;
  GLTFLoader: typeof GLTFLoader;
  /** `init()` once before a scene renders a `RectAreaLight` */
  RectAreaLightUniformsLib: { init(): void };
  THREE: typeof THREE;
}

/**
 * The host's three.js, typed. It loads on the first call, so a stage pays for
 * the engine only when it builds its scene.
 */
export async function three(): Promise<Three> {
  return (await loadThree()) as Three;
}

/**
 * A DRACOLoader that decodes with the WebAssembly decoder the realm serves
 * from `asset/draco/`.
 *
 * DRACOLoader names its decoder files itself — `draco_wasm_wrapper.js` beside
 * `draco_decoder.wasm` — and the realm compiles a `.js` file as a card module
 * rather than serving it as written. The wrapper is kept as `.mjs`, which the
 * realm serves verbatim, and the loader's URL modifier points the one request
 * at it.
 */
export function dracoLoader(
  { THREE: T, DRACOLoader }: Three,
  decoderPath: string,
) {
  const manager = new T.LoadingManager();
  manager.setURLModifier((url) =>
    url.endsWith('/draco_wasm_wrapper.js') ? url.replace(/\.js$/, '.mjs') : url,
  );
  return new DRACOLoader(manager)
    .setDecoderPath(decoderPath)
    .setDecoderConfig({ type: 'wasm' });
}
