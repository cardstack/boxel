import { modifier } from './modifier.ts';

// Makes a textarea as tall as what it holds, lines it wraps included, where
// the browser doesn't already size it by its content (`field-sizing:
// content`). It fits again whenever the value it is given changes
// (`{{fitContent @value}}`) and whenever the textarea's width changes, which
// wraps its lines differently. A fit replaces any height the user dragged it
// to. The height is set through the CSSOM, which the secure origin's style
// policy allows.
export const fitContent = modifier(
  (element: HTMLTextAreaElement, _value: string | null | undefined) => {
    if (
      getComputedStyle(element).getPropertyValue('field-sizing') === 'content'
    ) {
      element.style.removeProperty('height');
      return;
    }
    fit(element);
    let width = element.clientWidth;
    let frame: number | undefined;
    // The refit waits for the next frame: a height set while the observer
    // delivers would be a resize it must deliver again in the same frame.
    let observer = new ResizeObserver(() => {
      if (element.clientWidth === width || frame !== undefined) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = undefined;
        width = element.clientWidth;
        fit(element);
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  },
);

function fit(element: HTMLTextAreaElement) {
  element.style.setProperty('height', 'auto');
  let borders = element.offsetHeight - element.clientHeight;
  element.style.setProperty('height', `${element.scrollHeight + borders}px`);
}
