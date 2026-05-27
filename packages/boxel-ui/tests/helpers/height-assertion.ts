export default function (assert: Assert) {
  assert.hasNumericStyle = function (
    target: string | Element | null,
    propertyName: string,
    expectedValue: number,
    allowedDifference = 0,
  ) {
    let message =
      `expected ${target} to have ${propertyName} ` +
      (allowedDifference
        ? `within ${allowedDifference} of ${expectedValue}`
        : `of ${expectedValue}`);
    let el: Element | null = null;
    if (typeof target === 'string') {
      el =
        document.querySelector('#ember-testing')?.querySelector(target) || null;
    } else {
      el = target;
    }
    if (!el) {
      throw new Error(`No element specified/found. Target was ${target}`);
    }
    let cStyle = getComputedStyle(el);
    let actualValue = cStyle[propertyName as any];
    let actualNumericValue: number;
    if (typeof actualValue === 'number') {
      actualNumericValue = actualValue;
    } else {
      actualNumericValue = Number(actualValue.replace(/[^0-9.]/g, ''));
    }
    if (Math.abs(actualNumericValue - expectedValue) <= allowedDifference) {
      this.pushResult({
        result: true,
        actual: actualValue,
        expected: allowedDifference
          ? `within ${allowedDifference} of ${expectedValue}`
          : expectedValue,
        message,
      });
    } else {
      this.pushResult({
        result: false,
        actual: actualValue,
        expected: allowedDifference
          ? `within ${allowedDifference} of ${expectedValue}`
          : expectedValue,
        message,
      });
    }
  };
}

declare global {
  interface Assert {
    hasNumericStyle(
      target: string | Element | null,
      propertyName: string,
      expectedValue: number,
      allowedDifferencePx?: number,
    ): void;
  }
}
