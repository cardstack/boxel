import { modifier } from 'ember-modifier';

export type SafeModifierOperation =
  | 'focus'
  | 'observe-size'
  | 'scroll-into-view';

export interface SafeElementSize {
  height: number;
  width: number;
}

type SizeCallback = (size: SafeElementSize) => unknown;

interface SafeModifierNamedArgs {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
  preventScroll?: boolean;
}

function finiteDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function elementSize(element: Element): SafeElementSize {
  let { height, width } = element.getBoundingClientRect();
  return Object.freeze({
    height: finiteDimension(height),
    width: finiteDimension(width),
  });
}

// This is the only modifier intended for SES-authored templates. It executes
// in the trusted renderer and exposes a small operation vocabulary instead of
// passing the host Element into realm code. Callback arguments are plain,
// frozen data and can cross the realm-compartment JSON boundary.
const safeModifier = modifier(
  (
    element: HTMLElement,
    [operation, callback]: [SafeModifierOperation, SizeCallback?],
    options: SafeModifierNamedArgs,
  ) => {
    switch (operation) {
      case 'focus':
        element.focus({ preventScroll: options.preventScroll === true });
        return;
      case 'scroll-into-view':
        element.scrollIntoView({
          behavior: options.behavior ?? 'auto',
          block: options.block ?? 'nearest',
          inline: options.inline ?? 'nearest',
        });
        return;
      case 'observe-size': {
        if (typeof callback !== 'function') {
          throw new TypeError('safeModifier observe-size requires a callback');
        }
        let publishSize = () => callback(elementSize(element));
        publishSize();
        let observer = new ResizeObserver(publishSize);
        observer.observe(element);
        return () => observer.disconnect();
      }
      default:
        throw new TypeError(`Unsupported safeModifier operation: ${operation}`);
    }
  },
);

export default safeModifier;
