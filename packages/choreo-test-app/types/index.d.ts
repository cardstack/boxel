/// <reference types="@embroider/core/virtual" />
/// <reference types="vite/client" />

/**
 * three 0.185 ships no .d.ts. We only use a Points cloud; a full
 * @types/three pull is Rapier and friends we do not want.
 */
declare module 'three' {
  export const AdditiveBlending: number;

  export class CanvasTexture {
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
    setAttribute(name: string, attribute: Float32BufferAttribute): this;
    dispose(): void;
  }

  export class PerspectiveCamera {
    aspect: number;
    position: { z: number };
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

  export class Points {
    rotation: { x: number; y: number };
    constructor(geometry: BufferGeometry, material: PointsMaterial);
  }

  export class Scene {
    add(object: Points): this;
  }

  export class WebGLRenderer {
    constructor(params?: {
      alpha?: boolean;
      antialias?: boolean;
      canvas?: HTMLCanvasElement;
      powerPreference?: string;
    });
    setClearColor(hex: number, alpha: number): void;
    setPixelRatio(ratio: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: Scene, camera: PerspectiveCamera): void;
    dispose(): void;
  }
}
