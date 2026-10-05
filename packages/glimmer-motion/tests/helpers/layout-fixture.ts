/**
 * Harness for the Cypress layout fixtures (Motion's packages/framer-motion/cypress/integration/layout-*.ts).
 *
 * Cypress visits dev/react at a 1000×660 viewport and measures getBoundingClientRect() against the
 * page origin. ember-testing renders inside a 50%-scaled container, so for these suites the container
 * is pinned to the viewport origin at Cypress' size, unscaled, and made the containing block for
 * position: fixed descendants (contain: layout), so full-viewport overlays in fixtures get Cypress' viewport too
 * (not in `scroll` mode: layout containment would also stop the document from growing, and scrolling). `should()` keeps Cypress' retry semantics:
 * the assertions are re-run until they pass or 4s elapse, then asserted for real.
 */
import { settled } from '@ember/test-helpers';
import { rootProjectionNode } from 'motion-dom';

import { sleep } from './motion';

export interface Bbox {
  height?: number;
  left?: number;
  top?: number;
  width?: number;
}
type Rounding = 'exact' | 'round' | 'floor';

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
    // Cypress visits a fresh page per test: the document projection node (root of every projection tree,
    // with its per-animationId scroll cache) is per page too
    (rootProjectionNode as { current: unknown }).current = undefined;
  });
  hooks.afterEach(function () {
    style?.remove();
    window.scrollTo(0, 0);
  });
}

class ProbeFailure extends Error {}
/** a throwing stand-in for QUnit's assert, used while retrying */
const probe = {
  strictEqual(a: unknown, b: unknown, msg?: string) {
    if (a !== b) {
      throw new ProbeFailure(
        `${msg ?? ''} expected ${String(b)} got ${String(a)}`,
      );
    }
  },
  notStrictEqual(a: unknown, b: unknown, msg?: string) {
    if (a === b) {
      throw new ProbeFailure(`${msg ?? ''} expected not ${String(b)}`);
    }
  },
  true(v: unknown, msg?: string) {
    if (v !== true) {
      throw new ProbeFailure(`${msg ?? ''} expected true`);
    }
  },
  false(v: unknown, msg?: string) {
    if (v !== false) {
      throw new ProbeFailure(`${msg ?? ''} expected false`);
    }
  },
  ok(v: unknown, msg?: string) {
    if (!v) {
      throw new ProbeFailure(`${msg ?? ''} expected truthy`);
    }
  },
  closeTo(a: number, b: number, d: number, msg?: string) {
    if (Math.abs(a - b) > d) {
      throw new ProbeFailure(`${msg ?? ''} expected ${a} within ${d} of ${b}`);
    }
  },
};
export type ProbeAssert = typeof probe;

/** cy.should(fn): retry until the assertions hold (or 4s), then assert for real */
export async function should(
  assert: Assert,
  fn: (a: ProbeAssert) => void,
  timeout = 4000,
) {
  const t0 = performance.now();
  for (;;) {
    try {
      fn(probe);
      break;
    } catch (e) {
      if (!(e instanceof ProbeFailure) || performance.now() - t0 > timeout) {
        break;
      }
    }
    await sleep(16);
  }
  const real: ProbeAssert = {
    strictEqual: (a, b, m) => assert.strictEqual(a, b, m),
    notStrictEqual: (a, b, m) => assert.notStrictEqual(a, b, m),
    true: (v, m) => assert.true(v as boolean, m),
    false: (v, m) => assert.false(v as boolean, m),
    ok: (v, m) => assert.ok(v, m),
    closeTo: (a, b, d, m) =>
      assert.true(Math.abs(a - b) <= d, `${m ?? ''} ${a} within ${d} of ${b}`),
  };
  fn(real);
}

export function expectBbox(
  a: ProbeAssert,
  el: Element,
  expected: Bbox,
  rounding: Rounding = 'exact',
) {
  const r = el.getBoundingClientRect();
  const f =
    rounding === 'round'
      ? Math.round
      : rounding === 'floor'
        ? Math.floor
        : (n: number) => n;
  for (const key of ['top', 'left', 'width', 'height'] as const) {
    if (expected[key] !== undefined) {
      a.strictEqual(f(r[key]), expected[key], key);
    }
  }
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
  init: PointerEventInit = {},
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

/**
 * The `pointer(el, type, x, y)` of Motion's release-before-frame specs: a pointer event at viewport
 * point (x, y), not relative to the element, with no `buttons` and not cancelable, as the specs build it.
 */
export function pointerAt(el: Element, type: string, x: number, y: number) {
  el.dispatchEvent(
    new PointerEvent(type, {
      clientX: x,
      clientY: y,
      isPrimary: true,
      bubbles: true,
      pointerId: 1,
      button: 0,
      pointerType: 'mouse',
    }),
  );
}

/** cy.click(): pointer + mouse down/up then click, at the element's centre */
export async function cyClick(target: Element | string) {
  const el = typeof target === 'string' ? $(target) : target;
  const r = el.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
    button: 0,
  };
  trigger(el, 'pointerdown');
  el.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
  trigger(el, 'pointerup');
  el.dispatchEvent(new MouseEvent('mouseup', init));
  el.dispatchEvent(new MouseEvent('click', init));
  await settled();
}
