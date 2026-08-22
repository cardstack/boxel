import type { PresenceContextProps } from 'motion-dom';

/** what one item inside <Presence> hands to its {{motion}} element */
export interface PresenceHandle {
  readonly anchorX: 'left' | 'right';
  readonly anchorY: 'top' | 'bottom';
  readonly context: PresenceContextProps;
  readonly isPresent: boolean;
  readonly key: string;
  readonly mode: 'sync' | 'wait' | 'popLayout';
  /** motion elements that inherit this presence (React: PresenceContext consumers) ask to be refreshed when it flips */
  subscribe(refresh: () => void): () => void;
}
