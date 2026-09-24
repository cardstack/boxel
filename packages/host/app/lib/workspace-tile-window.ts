import { join } from '@ember/runloop';

type TileObserver = {
  intersect: (visible: boolean) => void;
  resize: (height: number) => void;
};
const windows = new WeakMap<
  Element,
  {
    tiles: Map<HTMLElement, TileObserver>;
    intersection: IntersectionObserver;
    resize: ResizeObserver;
  }
>();

// One callback batch per viewport, rather than hundreds of observer callbacks
// each opening a separate Ember update when the dashboard becomes visible.
export function observeWorkspaceTile(
  element: HTMLElement,
  observer: TileObserver,
) {
  let root =
    element.closest('.workspace-chooser__content') ?? element.parentElement!;
  let window = windows.get(root);
  if (!window) {
    let tiles = new Map<HTMLElement, TileObserver>();
    let intersection = new IntersectionObserver(
      (entries) => {
        // Batch browser observer callbacks into one render.
        join(() => {
          for (let entry of entries) {
            let tile = entry.target as HTMLElement;
            tiles
              .get(tile)
              ?.intersect(
                entry.isIntersecting ||
                  tile.contains(document.activeElement) ||
                  !!tile.querySelector('.is-open'),
              );
          }
        });
      },
      { root, rootMargin: '400px' },
    );
    let resize = new ResizeObserver((entries) => {
      let heights = entries.map(({ target }) => ({
        target: target as HTMLElement,
        height:
          target.firstElementChild instanceof HTMLElement
            ? target.firstElementChild.offsetHeight
            : undefined,
      }));
      // Publish measurements together, after all layout reads.
      join(() => {
        for (let { target, height } of heights)
          if (height !== undefined) tiles.get(target)?.resize(height);
      });
    });
    window = { tiles, intersection, resize };
    windows.set(root, window);
  }
  window.tiles.set(element, observer);
  window.intersection.observe(element);
  window.resize.observe(element);
  return () => {
    window.tiles.delete(element);
    window.intersection.unobserve(element);
    window.resize.unobserve(element);
    if (!window.tiles.size) {
      window.intersection.disconnect();
      window.resize.disconnect();
      windows.delete(root);
    }
  };
}
