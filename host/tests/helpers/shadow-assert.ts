import type DOMAssertions from 'qunit-dom/dist/assertions';

export function shadowQuerySelectorAll(
  selector: string,
  root: Document | Element | ShadowRoot | DocumentFragment = document
): Element[] {
  let results = Array.from(root.querySelectorAll(selector));
  for (let checkRoot of Array.from(
    root.querySelectorAll('[data-test-shadow-component]')
  )) {
    results = results.concat(
      shadowQuerySelectorAll(selector, checkRoot.shadowRoot!)
    );
  }
  return results;
}

declare global {
  interface Assert {
    shadowDOM: typeof shadowDOM;
  }
}

function shadowDOM(
  this: Assert,
  target?: string | Element | null | undefined,
  rootElement?: Element | undefined
): DOMAssertions {
  let dom = this.dom(target, rootElement) as any;
  let DOMAssertionsClass = dom.constructor;
  class ShadowDOMAssertions extends DOMAssertionsClass {
    constructor(...args: unknown[]) {
      super(...args);
    }
    findElement() {
      if (this.target === null) {
        return null;
      } else if (typeof this.target === 'string') {
        // TODO: it would be more efficient to implement a shadowQuerySelector
        // that stops at the first found element
        return shadowQuerySelectorAll(this.target, this.rootElement)[0];
      } else if (this.target instanceof Element) {
        return this.target;
      } else {
        throw new TypeError('Unexpected Parameter: ' + this.target);
      }
    }
    findElements() {
      if (this.target === null) {
        return null;
      } else if (typeof this.target === 'string') {
        return shadowQuerySelectorAll(this.target, this.rootElement);
      } else if (this.target instanceof Element) {
        return this.target;
      } else {
        throw new TypeError('Unexpected Parameter: ' + this.target);
      }
    }
  }
  return new ShadowDOMAssertions(
    dom.target,
    dom.rootElement,
    dom.testContext
  ) as unknown as DOMAssertions;
}

QUnit.assert.shadowDOM = shadowDOM;
