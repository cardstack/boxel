import { modifier } from 'ember-modifier';

export const surfaceObserveEvent = 'boxel-surface-observe';

export interface SurfaceObservationValue {
  height: number;
  visible: boolean;
  width: number;
}

export interface SurfaceObserveIntent {
  callback(observation: SurfaceObservationValue): void;
  connected(release: () => void): void;
}

interface Signature {
  Args: {
    Positional: [(observation: SurfaceObservationValue) => void];
  };
  Element: HTMLElement;
}

/** Subscribe through the nearest execution adapter, never through ambient DOM. */
const surfaceObserve = modifier<Signature>((element, [callback]) => {
  let active = true;
  let release: () => void = () => undefined;
  queueMicrotask(() => {
    if (!active) {
      return;
    }
    element.dispatchEvent(
      new CustomEvent<SurfaceObserveIntent>(surfaceObserveEvent, {
        bubbles: true,
        composed: true,
        detail: {
          callback,
          connected(value) {
            release();
            release = value;
          },
        },
      }),
    );
  });
  return () => {
    active = false;
    release();
  };
});

export default surfaceObserve;
