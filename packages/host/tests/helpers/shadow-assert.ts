import type DOMAssertions from 'qunit-dom/dist/assertions';
import {
  waitUntil,
  waitFor as waitForHelper,
  fillIn as fillInHelper,
  click as clickHelper,
} from '@ember/test-helpers';

// TODO: it would be more efficient to implement a shadowQuerySelector
// that stops at the first found element
export function shadowQuerySelector(
  selector: string | Element,
  root: Document | Element | ShadowRoot | DocumentFragment = document
): Element {
  return shadowQuerySelectorAll(selector, root)[0];
}

export function shadowQuerySelectorAll(
  selector: string | Element,
  root: Document | Element | ShadowRoot | DocumentFragment = document
): Element[] {
  if (typeof selector === 'string') {
    let results = Array.from(root.querySelectorAll(selector));
    for (let checkRoot of Array.from(
      root.querySelectorAll('[data-test-shadow-component]')
    )) {
      results = results.concat(
        shadowQuerySelectorAll(selector, checkRoot.shadowRoot!)
      );
    }
    return results;
  } else if (selector instanceof Element) {
    return [selector];
  } else {
    throw new TypeError('Unexpected Parameter: ' + selector);
  }
}

export async function waitFor(selector: string): Promise<Element | Element[]> {
  try {
    let el: Element | undefined = undefined;
    for (let s of selector.split(' ')) {
      el = await waitUntil(() => shadowQuerySelector(s, el));
    }
    return el!;
  } catch (e) {
    return await waitForHelper(selector);
  }
}

export async function fillIn(
  selector: string | Element,
  text: string
): Promise<void> {
  return fillInHelper(shadowQuerySelector(selector) ?? selector, text);
}

export async function click(
  selector: string | Element,
  options?: MouseEventInit | undefined
): Promise<void> {
  await clickHelper(shadowQuerySelector(selector) ?? selector, options);
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
      }
      return shadowQuerySelector(this.target, this.rootElement);
    }
    findElements() {
      if (this.target === null) {
        return null;
      }
      return shadowQuerySelectorAll(this.target, this.rootElement);
    }
  }
  return new ShadowDOMAssertions(
    dom.target,
    dom.rootElement,
    dom.testContext
  ) as unknown as DOMAssertions;
}

QUnit.assert.shadowDOM = shadowDOM;
