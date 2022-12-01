export {};

function approximatePixels(val: string): number {
  return Math.round(Number(val.replace('px', '')));
}

declare global {
  interface Assert {
    pixels: typeof pixels;
  }
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
}
