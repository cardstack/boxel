import type { PresenceContextProps } from 'motion-dom';

import type { MotionEl, MotionProps, PopSeat } from './node.ts';

/**
 * A direct child of a <Presence>, which has to be read before the render
 * that removes it: popLayout measures its seat (React's PopChildMeasure does
 * this in getSnapshotBeforeUpdate; see MotionNode.measureForPop), and
 * snapshot copies it (see MotionNode.exitForCopy), pinning the copy to the
 * seat recorded before that render (see MotionNode.recordSeat).
 */
export interface PopMeasurable {
  exitForCopy():
    | { element: MotionEl; props: MotionProps; seat: PopSeat | undefined }
    | undefined;
  measureForPop(): void;
  recordSeat(): Element[];
}

/** what one item inside <Presence> hands to its {{motion}} element */
export interface PresenceHandle {
  readonly anchorX: 'left' | 'right';
  readonly anchorY: 'top' | 'bottom';
  readonly context: PresenceContextProps;
  readonly isPresent: boolean;
  readonly key: string;
  readonly mode: 'sync' | 'wait' | 'popLayout' | 'snapshot';
  /** popLayout and snapshot: the direct child asks to be read while it is still in flow */
  popCandidate(node: PopMeasurable): () => void;
  /** motion elements that inherit this presence (React: PresenceContext consumers) ask to be refreshed when it flips */
  subscribe(refresh: () => void): () => void;
}
