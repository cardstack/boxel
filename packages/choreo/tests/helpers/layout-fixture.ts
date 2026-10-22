/**
 * Pins the ember-testing container to the viewport origin at a fixed size,
 * unscaled, and makes it the containing block for position: fixed descendants
 * (contain: layout), so a fixture's getBoundingClientRect() reads in page
 * coordinates and a full-viewport overlay gets the fixture's viewport. In
 * `scroll` mode the containment is left off, since it would also stop the
 * document from growing and scrolling.
 */
import { rootProjectionNode } from 'motion-dom';

export function setupFixtureViewport(
  hooks: NestedHooks,
  opts: { height?: number; scroll?: boolean; width?: number } = {},
) {
  const { width = 1000, height = 660, scroll = false } = opts;
  let style: HTMLStyleElement | undefined;
  hooks.beforeEach(function () {
    style = document.createElement('style');
    style.id = 'fixture-viewport';
    style.textContent = `
      body { margin: 0 !important; }
      #qunit { visibility: hidden; }
      #qunit-fixture { position: static !important; top: auto !important; left: auto !important; width: auto !important; height: auto !important; }
      #ember-testing-container { position: ${scroll ? 'absolute' : 'fixed'} !important; left: 0 !important; top: 0 !important; width: ${width}px !important; height: ${height}px !important; overflow: visible !important; transform: none !important; zoom: 1 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: #242424; ${scroll ? '' : 'contain: layout;'} }
      #ember-testing { line-height: normal; position: relative !important; width: 100% !important; height: 100% !important; transform: none !important; zoom: 1 !important; margin: 0 !important; padding: 0 !important; }
      #ember-testing button { font: 16px system-ui; }
    `;
    document.head.appendChild(style);
    window.scrollTo(0, 0);
    // each test starts from a fresh document projection node (the root of
    // every projection tree, with its per-animationId scroll cache)
    (rootProjectionNode as { current: unknown }).current = undefined;
  });
  hooks.afterEach(function () {
    style?.remove();
    window.scrollTo(0, 0);
  });
}
