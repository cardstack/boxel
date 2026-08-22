import type { PresenceContextProps } from 'motion-dom';

/** what one item inside <Presence> hands to its {{motion}} element */
export interface PresenceHandle {
  readonly key: string;
  readonly isPresent: boolean;
  readonly mode: 'sync' | 'wait' | 'popLayout';
  readonly anchorX: 'left' | 'right';
  readonly anchorY: 'top' | 'bottom';
  readonly context: PresenceContextProps;
  /** motion elements that inherit this presence (React: PresenceContext consumers) ask to be refreshed when it flips */
  subscribe(refresh: () => void): () => void;
}
