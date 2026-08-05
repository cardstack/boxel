import { modifier } from 'ember-modifier';

export const surfacePresentationEvent = 'boxel-surface-presentation';

export interface SurfacePresentation {
  containerBackground: string | null;
}

interface SurfacePresentationNamedArgs {
  containerBackground?: string;
}

function safeSolidColor(value: string): string | null {
  let candidate = value.trim();
  if (
    candidate.length === 0 ||
    candidate.length > 128 ||
    /[;{}]/.test(candidate) ||
    /(?:url|var|image|gradient|currentcolor)\s*\(/i.test(candidate) ||
    candidate.toLowerCase() === 'currentcolor' ||
    (globalThis.CSS?.supports && !globalThis.CSS.supports('color', candidate))
  ) {
    return null;
  }
  return candidate;
}

function publish(element: HTMLElement, containerBackground: string | null) {
  element.dispatchEvent(
    new CustomEvent<SurfacePresentation>(surfacePresentationEvent, {
      bubbles: true,
      composed: true,
      detail: Object.freeze({ containerBackground }),
    }),
  );
}

// A surface publishes bounded placement metadata without receiving any Host
// chrome, iframe, or container authority. `match` is resolved by this trusted
// modifier to one computed solid color; only that inert result is observable
// by the Host presentation boundary.
const surfacePresentation = modifier(
  (
    element: HTMLElement,
    _positional: [],
    args: SurfacePresentationNamedArgs,
  ) => {
    let requested = args.containerBackground?.trim();
    let frame: number | undefined;
    let publishRequested = () => {
      let color =
        requested === 'match'
          ? globalThis.getComputedStyle(element).backgroundColor
          : requested;
      publish(element, color ? safeSolidColor(color) : null);
    };
    // Publish on the next frame for both explicit values and `match`. This
    // gives the owning renderer time to install its ancestor listener and
    // lets scoped component styles participate in the computed `match` value.
    frame = globalThis.requestAnimationFrame(publishRequested);
    return () => {
      if (frame != null) {
        globalThis.cancelAnimationFrame(frame);
      }
      publish(element, null);
    };
  },
);

export default surfacePresentation;
