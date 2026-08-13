import { modifier } from 'ember-modifier';

export const surfacePresentationEvent = 'boxel-surface-presentation';

export interface SurfacePresentationIntent {
  containerBackground?: string | null;
  headerColor?: string | null;
}

interface Signature {
  Args: {
    Named: {
      containerBackground?: string | null;
      headerColor?: string | null;
    };
  };
  Element: HTMLElement;
}

/** Publish inert presentation intent to the nearest Host-owned Surface. */
const surfacePresentation = modifier<Signature>(
  (element, _positional, named) => {
    let active = true;
    let presentation: SurfacePresentationIntent = {
      headerColor: named.headerColor,
      containerBackground: named.containerBackground,
    };
    queueMicrotask(() => {
      if (active) {
        publishPresentation(element, presentation);
      }
    });
    return () => {
      active = false;
      if (element.isConnected) {
        publishPresentation(element, {});
      }
    };
  },
);

function publishPresentation(
  element: HTMLElement,
  presentation: SurfacePresentationIntent,
): void {
  element.dispatchEvent(
    new CustomEvent(surfacePresentationEvent, {
      bubbles: true,
      composed: true,
      detail: presentation,
    }),
  );
}

export default surfacePresentation;
