import { modifier } from 'ember-modifier';

// Zooms content laid out as a page `pageWidth` design pixels wide into the
// frame it's drawn in, so prerendered HTML shows as a miniature of how it
// really looks rather than reflowing to the frame. Sets on the frame:
//   --page-width   the page's width in design pixels
//   --page-height  the frame's height in design pixels, so the page fills it
//   --page-zoom    the scale from design pixels to the frame
// The page inside takes `width: var(--page-width)`,
// `height: var(--page-height)` and `transform: scale(var(--page-zoom))` from
// a top-left origin. Layout sizes ignore transforms, so the zoom is read
// from the frame's untransformed box.
const fitPage = modifier((element: HTMLElement, [pageWidth]: [number]) => {
  element.style.setProperty('--page-width', `${pageWidth}px`);
  let apply = () => {
    let width = element.offsetWidth;
    if (width > 0) {
      let zoom = width / pageWidth;
      element.style.setProperty('--page-zoom', String(zoom));
      element.style.setProperty(
        '--page-height',
        `${element.offsetHeight / zoom}px`,
      );
    }
  };
  let observer = new ResizeObserver(apply);
  observer.observe(element);
  apply();
  return () => observer.disconnect();
});

export default fitPage;
