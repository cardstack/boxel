// @ts-nocheck — vendored verbatim from Motion's packages/framer-motion/src/render/dom/scroll/types.ts (motion@bbabb00)
import type { EasingFunction } from 'motion-utils';

export interface ScrollOptions {
  axis?: 'x' | 'y';
  container?: Element;
  offset?: ScrollOffset;
  source?: HTMLElement;
  target?: Element;
}

export interface ScrollOptionsWithDefaults extends ScrollOptions {
  axis: 'x' | 'y';
  container: Element;
}

export type OnScrollProgress = (progress: number) => void;
export type OnScrollWithInfo = (progress: number, info: ScrollInfo) => void;

export type OnScroll = OnScrollProgress | OnScrollWithInfo;

export interface AxisScrollInfo {
  containerLength: number;
  current: number;
  interpolate?: EasingFunction;
  interpolatorOffsets?: number[];
  offset: number[];

  progress: number;

  scrollLength: number;
  targetLength: number;
  // TODO Rename before documenting
  targetOffset: number;
  velocity: number;
}

export interface ScrollInfo {
  time: number;
  x: AxisScrollInfo;
  y: AxisScrollInfo;
}

export type OnScrollInfo = (info: ScrollInfo) => void;

export type OnScrollHandler = {
  measure: (time: number) => void;
  notify: () => void;
};

export type SupportedEdgeUnit = 'px' | 'vw' | 'vh' | '%';

export type EdgeUnit = `${number}${SupportedEdgeUnit}`;

export type NamedEdges = 'start' | 'end' | 'center';

export type EdgeString = NamedEdges | EdgeUnit | `${number}`;

export type Edge = EdgeString | number;

export type ProgressIntersection = [number, number];

export type Intersection = `${Edge} ${Edge}`;

export type ScrollOffset = Array<Edge | Intersection | ProgressIntersection>;

export interface ScrollInfoOptions {
  axis?: 'x' | 'y';
  container?: Element;
  offset?: ScrollOffset;
  target?: Element;
  /**
   * When true, enables per-frame checking of scrollWidth/scrollHeight
   * to detect content size changes and recalculate scroll progress.
   *
   * @default false
   */
  trackContentSize?: boolean;
}
