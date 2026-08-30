/// <reference types="@embroider/core/virtual" />
/// <reference types="vite/client" />

/**
 * three 0.185 ships no .d.ts. We only use a Points cloud; a full
 * @types/three pull is Rapier and friends we do not want.
 */
declare module 'three' {
  export const ACESFilmicToneMapping: number;
  export const SRGBColorSpace: string;
  export const AdditiveBlending: number;
  export const CustomBlending: number;
  export const EquirectangularReflectionMapping: number;
  export const OneFactor: number;
  export const ZeroFactor: number;

  export class CanvasTexture {
    colorSpace: string;
    mapping: number;
    needsUpdate: boolean;
    constructor(canvas: HTMLCanvasElement);
    dispose(): void;
  }

  export class Color {
    constructor(hex?: number);
    setHex(hex: number): this;
  }

  export class Float32BufferAttribute {
    constructor(array: Float32Array, itemSize: number);
  }

  export class BufferGeometry {
    boundingBox: Box3 | null;
    computeBoundingBox(): void;
    setAttribute(name: string, attribute: Float32BufferAttribute): this;
    dispose(): void;
  }

  export class PerspectiveCamera extends Object3D {
    aspect: number;
    fov: number;
    matrixWorldInverse: Matrix4;
    projectionMatrix: Matrix4;
    constructor(fov: number, aspect: number, near: number, far: number);
    updateProjectionMatrix(): void;
  }

  export class PointsMaterial {
    color: Color;
    constructor(params?: {
      blending?: number;
      color?: Color;
      depthWrite?: boolean;
      map?: CanvasTexture;
      opacity?: number;
      size?: number;
      sizeAttenuation?: boolean;
      transparent?: boolean;
    });
    dispose(): void;
  }

  export class Points extends Object3D {
    constructor(geometry: BufferGeometry, material: PointsMaterial);
  }

  export class Scene extends Object3D {
    environment: unknown;
  }

  // ── the mockup spike's slice of three (still hand-written: see above) ──

  export const ACESFilmicToneMapping: number;
  export const SRGBColorSpace: string;
  export const AdditiveBlending: number;
  export const CustomBlending: number;
  export const EquirectangularReflectionMapping: number;
  export const OneFactor: number;
  export const ZeroFactor: number;
  export const NoBlending: number;

  export class Vector3 {
    toArray(): number[];
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    addScaledVector(v: Vector3, s: number): this;
    applyQuaternion(q: Quaternion): this;
    clone(): Vector3;
    copy(v: Vector3): this;
    multiplyScalar(s: number): this;
    normalize(): this;
    set(x: number, y: number, z: number): this;
    sub(v: Vector3): this;
  }

  export class Euler {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number, order?: string);
    set(x: number, y: number, z: number): this;
  }

  export class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x?: number, y?: number, z?: number, w?: number);
    copy(q: Quaternion): this;
    invert(): this;
    multiply(q: Quaternion): this;
    setFromEuler(euler: Euler): this;
  }

  export class Matrix4 {
    elements: number[];
  }

  export class Layers {
    disable(channel: number): void;
    enable(channel: number): void;
    set(channel: number): void;
    test(layers: Layers): boolean;
  }

  export class Object3D {
    layers: Layers;
    matrixWorld: Matrix4;
    parent: Object3D | null;
    name: string;
    position: Vector3;
    rotation: Euler;
    scale: Vector3;
    visible: boolean;
    quaternion: Quaternion;
    add(object: Object3D): this;
    clone(): this;
    getWorldQuaternion(target: Quaternion): Quaternion;
    getWorldScale(target: Vector3): Vector3;
    lookAt(x: number, y: number, z: number): void;
    traverse(callback: (object: Object3D) => void): void;
    updateMatrixWorld(force?: boolean): void;
  }

  export class Box3 {
    max: Vector3;
    min: Vector3;
    clone(): Box3;
    getCenter(target: Vector3): Vector3;
    getSize(target: Vector3): Vector3;
    setFromObject(object: Object3D): this;
  }

  export class Material {
    name: string;
    polygonOffset?: boolean;
    polygonOffsetFactor?: number;
    polygonOffsetUnits?: number;
    dispose(): void;
  }

  export class PlaneGeometry {
    constructor(width?: number, height?: number);
  }

  export class MeshBasicMaterial extends Material {
    constructor(params?: { color?: number; map?: CanvasTexture });
  }

  export class MeshPhysicalMaterial extends Material {
    constructor(params?: {
      alphaTest?: number;
      blendDst?: number;
      blendDstAlpha?: number;
      blendSrc?: number;
      blendSrcAlpha?: number;
      blending?: number;
      clearcoat?: number;
      clearcoatRoughness?: number;
      color?: number;
      depthWrite?: boolean;
      envMap?: unknown;
      envMapIntensity?: number;
      metalness?: number;
      opacity?: number;
      roughness?: number;
      transparent?: boolean;
    });
  }

  export class Mesh extends Object3D {
    isMesh: boolean;
    geometry: BufferGeometry;
    material: Material | Material[];
    constructor(geometry?: unknown, material?: Material);
  }

  export class AmbientLight extends Object3D {
    constructor(color?: number, intensity?: number);
  }

  export class DirectionalLight extends Object3D {
    constructor(color?: number, intensity?: number);
  }

  export class RectAreaLight extends Object3D {
    color: Color;
    constructor(
      color?: number,
      intensity?: number,
      width?: number,
      height?: number
    );
  }

  export class PointLight extends Object3D {
    constructor(
      color?: number,
      intensity?: number,
      distance?: number,
      decay?: number
    );
  }

  export class PMREMGenerator {
    constructor(renderer: WebGLRenderer);
    fromEquirectangular(texture: CanvasTexture): { texture: unknown };
    fromScene(scene: Object3D, sigma?: number): { texture: unknown };
  }

  export class WebGLRenderer {
    constructor(params?: {
      alpha?: boolean;
      antialias?: boolean;
      canvas?: HTMLCanvasElement;
      powerPreference?: string;
    });
    clear(): void;
    setClearColor(hex: number, alpha: number): void;
    setPixelRatio(ratio: number): void;
    domElement: HTMLCanvasElement;
    toneMapping: number;
    toneMappingExposure: number;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: Scene, camera: PerspectiveCamera): void;
    dispose(): void;
  }
}

/** three's addons ship no types either; the spike uses three of them */
declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import type { Object3D } from 'three';
  export class GLTFLoader {
    load(
      url: string,
      onLoad: (gltf: { scene: Object3D }) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (error: unknown) => void
    ): void;
    setDRACOLoader(loader: unknown): this;
  }
}

declare module 'three/examples/jsm/loaders/DRACOLoader.js' {
  export class DRACOLoader {
    setDecoderPath(path: string): this;
  }
}

declare module 'three/examples/jsm/lights/RectAreaLightUniformsLib.js' {
  export const RectAreaLightUniformsLib: { init(): void };
}

declare module 'three/examples/jsm/environments/RoomEnvironment.js' {
  import type { Object3D } from 'three';
  export class RoomEnvironment extends Object3D {}
}
