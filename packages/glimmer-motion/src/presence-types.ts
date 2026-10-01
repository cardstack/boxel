import type { PresenceContextProps } from 'motion-dom';

/**
 * A direct child of a popLayout <Presence>, which has to be measured before
 * the render that removes it. React's PopChildMeasure does this in
 * getSnapshotBeforeUpdate; see MotionNode.measureForPop.
 */
export interface PopMeasurable {
  measureForPop(): void;
}

/** what one item inside <Presence> hands to its {{motion}} element */
export interface PresenceHandle {
  readonly anchorX: 'left' | 'right';
  readonly anchorY: 'top' | 'bottom';
  readonly context: PresenceContextProps;
  readonly isPresent: boolean;
  readonly key: string;
  readonly mode: 'sync' | 'wait' | 'popLayout';
  /** popLayout: the direct child asks to be measured while it is still in flow */
  popCandidate(node: PopMeasurable): () => void;
  /** motion elements that inherit this presence (React: PresenceContext consumers) ask to be refreshed when it flips */
  subscribe(refresh: () => void): () => void;
}
