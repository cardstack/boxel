/**
 * Harness for the Cypress layout fixtures (Motion's packages/framer-motion/cypress/integration/layout-*.ts).
 *
 * Cypress visits dev/react at a 1000×660 viewport and measures getBoundingClientRect() against the
 * page origin. ember-testing renders inside a 50%-scaled container, so for these suites the container
 * is pinned to the viewport origin at Cypress' size, unscaled, and made the containing block for
 * position: fixed descendants (contain: layout), so full-viewport overlays in fixtures get Cypress' viewport too
 * (not in `scroll` mode: layout containment would also stop the document from growing, and scrolling).
 */
import { rootProjectionNode } from 'motion-dom';

import { sleep } from './motion';

export function setupFixtureViewport(
  hooks: NestedHooks,
  opts: { height?: number; scroll?: boolean; width?: number } = {}
) {
  const { width = 1000, height = 660, scroll = false } = opts;
  let style: HTMLStyleElement | undefined;
  /** the app stylesheets this fixture muted, with the media query each had */
  let muted: { link: HTMLLinkElement; media: string }[] = [];
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
    // a Cypress page has only the fixture's CSS: the app's stylesheet stays out of fixture tests
    //
    // It is muted with `media`, NOT with `disabled`, and the difference is
    // measurable: setting `link.disabled = true` DETACHES the sheet in
    // Chromium — `link.sheet` goes null — and clearing the flag again does
    // not put it back synchronously. The page keeps rendering with no app
    // CSS until the sheet is reattached a few frames later (~17ms on an idle
    // machine; unbounded on a loaded one). So this helper's afterEach could
    // not restore what its beforeEach took away, and every fixture test left
    // a window behind it with the app stylesheet missing.
    //
    // The subdivision demo test is the one test that reads its geometry out
    // of that stylesheet, and it runs right after a module that uses this
    // fixture — which is how it came to measure a completely unstyled
    // component in CI and report tiles 95x21 (an untouched `button`) instead
    // of the grid it was asserting about.
    //
    // `media="not all"` takes the sheet out of the cascade without unloading
    // it: `link.sheet` stays, and both muting and restoring take effect in
    // the same frame.
    muted = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
    )
      .filter(
        (l) => /app\.css|\/assets\/app/.test(l.href) && !/tests/.test(l.href)
      )
      .map((link) => ({ link, media: link.media }));
    muted.forEach(({ link }) => {
      link.media = 'not all';
    });
    window.scrollTo(0, 0);
    // Cypress visits a fresh page per test: the document projection node (root of every projection tree,
    // with its per-animationId scroll cache) is per page too
    (rootProjectionNode as { current: unknown }).current = undefined;
  });
  hooks.afterEach(function () {
    muted.forEach(({ link, media }) => {
      link.media = media;
    });
    muted = [];
    style?.remove();
    window.scrollTo(0, 0);
  });
}

export const wait = sleep;
export const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

/**
 * cy.trigger(name, x, y): a pointer event at (x, y) relative to the element's CURRENT top-left
 * (Cypress re-measures the element for every trigger; default position is its centre).
 * Events bubble to window, where PanSession listens for moves/ups.
 */
export function trigger(
  target: Element | string,
  type: string,
  x?: number,
  y?: number,
  init: PointerEventInit = {}
) {
  const el = typeof target === 'string' ? $(target) : target;
  const r = el.getBoundingClientRect();
  const clientX = r.left + (x ?? r.width / 2);
  const clientY = r.top + (y ?? r.height / 2);
  const down = type === 'pointerdown' || type === 'pointermove';
  const ev = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: down ? 1 : 0,
    ...init,
  });
  el.dispatchEvent(ev);
  return ev;
}
