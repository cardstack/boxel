// Hand-written types for the vendored bundle in this directory, so a host or
// catalog card that imports SignaturePad type-checks. Follows signature_pad's
// own published types, trimmed to what Pret UI and its tests use.

export interface BasicPoint {
  x: number;
  y: number;
  pressure: number;
  time: number;
}

export declare class Point implements BasicPoint {
  x: number;
  y: number;
  pressure: number;
  time: number;
  constructor(x: number, y: number, pressure?: number, time?: number);
  distanceTo(start: BasicPoint): number;
  equals(other: BasicPoint): boolean;
  velocityFrom(start: BasicPoint): number;
}

export declare class Bezier {
  static fromPoints(
    points: Point[],
    widths: { start: number; end: number },
  ): Bezier;
  startPoint: Point;
  control2: BasicPoint;
  control1: BasicPoint;
  endPoint: Point;
  startWidth: number;
  endWidth: number;
  length(): number;
}

export interface PointGroup {
  points: BasicPoint[];
  penColor: string;
  dotSize: number;
  minWidth: number;
  maxWidth: number;
  velocityFilterWeight: number;
  compositeOperation: GlobalCompositeOperation;
}

export interface SignaturePadOptions {
  dotSize?: number;
  minWidth?: number;
  maxWidth?: number;
  minDistance?: number;
  backgroundColor?: string;
  penColor?: string;
  throttle?: number;
  velocityFilterWeight?: number;
  compositeOperation?: GlobalCompositeOperation;
  canvasContextOptions?: CanvasRenderingContext2DSettings;
}

export default class SignaturePad extends EventTarget {
  constructor(canvas: HTMLCanvasElement, options?: SignaturePadOptions);
  dotSize: number;
  minWidth: number;
  maxWidth: number;
  penColor: string;
  backgroundColor: string;
  clear(): void;
  redraw(): void;
  isEmpty(): boolean;
  on(): void;
  off(): void;
  toData(): PointGroup[];
  fromData(pointGroups: PointGroup[], options?: { clear?: boolean }): void;
  toDataURL(type?: string, encoderOptions?: number): string;
  toSVG(options?: {
    includeBackgroundColor?: boolean;
    includeDataUrl?: boolean;
  }): string;
}
