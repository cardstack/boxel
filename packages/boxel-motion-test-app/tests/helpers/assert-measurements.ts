export {};

function approximatePixels(val: string): number {
  return Math.round(Number(val.replace('px', '')));
}

declare global {
  interface Assert {
    pixels: typeof pixels;
    visualContinuity: typeof visualContinuity;
  }
}

function simplifiedBounds(rect: DOMRect) {
  return {
    bottom: rect.bottom,
    top: rect.top,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    height: rect.height,
  };
}

function equalBounds(
  this: Assert,
  actual: DOMRect,
  expected: DOMRect,
  message?: string
) {
  let simplifiedActual = simplifiedBounds(actual);
  let simplifiedExpected = simplifiedBounds(expected);

  this.pushResult({
    // Tolerate errors less than a quarter pixels. This prevents any invisible rounding errors from failing our tests.
    result: Object.entries(simplifiedExpected).every(
      ([field, value]) =>
        Math.abs((simplifiedActual as any)[field] - value) < 0.25
    ),
    actual: simplifiedActual,
    expected: simplifiedExpected,
    message,
  });
}

async function visualContinuity(
  this: Assert,
  target: string,
  callback: () => Promise<void>
): Promise<void> {
  let el = document.querySelector(target);
  if (!el) {
    return this.pushResult({
      result: false,
      expected: `${target} to exist`,
      actual: `${target} not found`,
      message: 'could not locate element at start of visualContinuity',
    });
  }
  let startBounds = el.getBoundingClientRect();
  await callback();

  el = document.querySelector(target);
  if (!el) {
    return this.pushResult({
      result: false,
      expected: `${target} to exist`,
      actual: `${target} not found`,
      message: 'could not locate element at end of visualContinuity',
    });
  }

  let endBounds = el.getBoundingClientRect();
  equalBounds.call(this, endBounds, startBounds, 'visual continuity');
}

function pixels(
  this: Assert,
  target: string,
  expected: Partial<Record<keyof CSSStyleDeclaration, number>>,
  message?: string
): void {
  let el = document.querySelector(target);
  if (!el) {
    return this.pushResult({
      result: false,
      expected: `${target} to exist`,
      actual: `${target} not found`,
      message: 'could not locate element',
    });
  }
  let computedStyle = getComputedStyle(el);
  let expectedProperties = Object.keys(
    expected
  ) as (keyof CSSStyleDeclaration)[];
  if (expectedProperties.length <= 0) {
    throw new TypeError(
      'Missing style expectations. There must be at least one style property in the passed in expectation object.'
    );
  }
  let result = expectedProperties.every(function (property) {
    return (
      approximatePixels(computedStyle[property] as string) ===
      Math.round(expected[property]!)
    );
  });
  let actual: Partial<Record<keyof CSSStyleDeclaration, any>> = {};
  expectedProperties.forEach(function (property) {
    return (actual[property] = computedStyle[property]);
  });
  if (!message) {
    message = `Expected element to have styles: "${JSON.stringify(expected)}"`;
  }
  this.pushResult({
    result: result,
    actual: actual,
    expected: expected,
    message: message,
  });
}

export function setup(assert: Assert) {
  assert.pixels = pixels;
  assert.visualContinuity = visualContinuity;
}
