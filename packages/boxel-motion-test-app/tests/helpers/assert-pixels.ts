import type DOMAssertions from 'qunit-dom/dist/assertions';

function approximatePixels(val: number | string, scale = 1): number {
  // scale param is to adjust for testem's scaling as needed
  return Math.round(Number(`${val}`.replace('px', '')) * scale);
}

declare global {
  interface Assert {
    pixels: typeof pixels;
  }
}

function pixels(
  this: Assert,
  target: string | Element | null | undefined,
  expected: Record<string, any>,
  message?: string
): DOMAssertions {
  let dom = this.dom(target, document) as any;
  let DOMAssertionsClass = dom.constructor;
  class PixelAssertions extends DOMAssertionsClass {
    constructor(...args: unknown[]) {
      super(...args);
      this.getApproximateValue();
    }
    getApproximateValue() {
      let el = document.querySelector(this['target']);
      if (!el) {
        return this;
      }
      let computedStyle: Record<string, any> = window.getComputedStyle(el);
      var expectedProperties = Object.keys(expected);
      if (expectedProperties.length <= 0) {
        throw new TypeError(
          'Missing style expectations. There must be at least one style property in the passed in expectation object.'
        );
      }
      var result = expectedProperties.every(function (property) {
        if (computedStyle[property] === expected[property]) {
          return true;
        }
        return (
          approximatePixels(computedStyle[property], 2) ===
          approximatePixels(expected[property])
        );
      });
      var actual: Record<string, any> = {};
      expectedProperties.forEach(function (property) {
        return (actual[property] = computedStyle[property]);
      });
      if (!message) {
        message = `Expected element to have styles: "${JSON.stringify(
          expected
        )}"`;
      }
      this['pushResult']({
        result: result,
        actual: actual,
        expected: expected,
        message: message,
      });
      return this;
    }
  }
  return new PixelAssertions(
    dom.target,
    dom.rootElement,
    dom.testContext
  ) as unknown as DOMAssertions;
}

QUnit.assert.pixels = pixels;
