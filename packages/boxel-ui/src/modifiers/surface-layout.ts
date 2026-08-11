import { modifier } from 'ember-modifier';

export const surfaceLayoutEvent = 'boxel-surface-layout';

export interface SurfaceLayoutIntent {
  heightMode: 'intrinsic' | 'allocated';
  minimumHeight?: number;
}

interface Signature {
  Args: {
    Named: SurfaceLayoutIntent;
  };
  Element: HTMLElement;
}

/** Publish bounded layout intent without receiving the owning DOM element. */
const surfaceLayout = modifier<Signature>((element, _positional, named) => {
  let active = true;
  queueMicrotask(() => {
    if (!active) {
      return;
    }
    element.dispatchEvent(
      new CustomEvent(surfaceLayoutEvent, {
        bubbles: true,
        composed: true,
        detail: {
          heightMode: named.heightMode,
          minimumHeight: named.minimumHeight,
        } satisfies SurfaceLayoutIntent,
      }),
    );
  });
  return () => {
    active = false;
  };
});

export default surfaceLayout;
