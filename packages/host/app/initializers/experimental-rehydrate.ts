import type Application from '@ember/application';

// @ts-expect-error - glimmer internals not typed for direct import
import { clientBuilder, rehydrationBuilder } from '@glimmer/runtime';
// @ts-expect-error - glimmer internals not typed for direct import
import { ConcreteBounds, NewElementBuilder } from '@glimmer/runtime';

declare const FastBoot: unknown;

// Inlined from @glimmer/node to avoid pulling in a second copy of
// @glimmer/runtime (and its transitive @glimmer/global-context) which
// would cause webpack to bundle two uninitialised copies and break at
// runtime with "scheduleDestroyed is not a function".
const NEEDS_EXTRA_CLOSE = new WeakMap();

class SerializeBuilder extends (NewElementBuilder as any) {
  serializeBlockDepth = 0;

  __openBlock() {
    let { tagName } = this.element;
    if (tagName !== 'TITLE' && tagName !== 'SCRIPT' && tagName !== 'STYLE') {
      let depth = this.serializeBlockDepth++;
      this.__appendComment(`%+b:${depth}%`);
    }
    super.__openBlock();
  }

  __closeBlock() {
    let { tagName } = this.element;
    super.__closeBlock();
    if (tagName !== 'TITLE' && tagName !== 'SCRIPT' && tagName !== 'STYLE') {
      let depth = --this.serializeBlockDepth;
      this.__appendComment(`%-b:${depth}%`);
    }
  }

  __appendHTML(html: string) {
    let { tagName } = this.element;
    if (tagName === 'TITLE' || tagName === 'SCRIPT' || tagName === 'STYLE') {
      return super.__appendHTML(html);
    }
    let first = this.__appendComment('%glmr%');
    if (tagName === 'TABLE') {
      let openIndex = html.indexOf('<');
      if (openIndex > -1 && html.slice(openIndex + 1, openIndex + 3) === 'tr') {
        html = `<tbody>${html}</tbody>`;
      }
    }
    if (html === '') {
      this.__appendComment('% %');
    } else {
      super.__appendHTML(html);
    }
    let last = this.__appendComment('%glmr%');
    return new (ConcreteBounds as any)(this.element, first, last);
  }

  __appendText(string: string) {
    let { tagName } = this.element;
    let current = ((): any => {
      let { element, nextSibling } = this as any;
      return nextSibling === null ? element.lastChild : nextSibling.previousSibling;
    })();
    if (tagName === 'TITLE' || tagName === 'SCRIPT' || tagName === 'STYLE') {
      return super.__appendText(string);
    }
    if (string === '') {
      return this.__appendComment('% %');
    }
    if (current && current.nodeType === 3) {
      this.__appendComment('%|%');
    }
    return super.__appendText(string);
  }

  closeElement() {
    if (NEEDS_EXTRA_CLOSE.has(this.element)) {
      NEEDS_EXTRA_CLOSE.delete(this.element);
      super.closeElement();
    }
    return super.closeElement();
  }

  openElement(tag: string) {
    if (
      tag === 'tr' &&
      this.element.tagName !== 'TBODY' &&
      this.element.tagName !== 'THEAD' &&
      this.element.tagName !== 'TFOOT'
    ) {
      this.openElement('tbody');
      NEEDS_EXTRA_CLOSE.set(this.constructing, true);
      this.flushElement(null);
    }
    return super.openElement(tag);
  }

  pushRemoteElement(element: any, cursorId: string, insertBefore: any = null) {
    let { dom } = this as any;
    let script = dom.createElement('script');
    script.setAttribute('glmr', cursorId);
    dom.insertBefore(element, script, insertBefore);
    return super.pushRemoteElement(element, cursorId, insertBefore);
  }
}

function serializeBuilder(env: any, cursor: any) {
  return SerializeBuilder.forInitialRender(env, cursor);
}

export function initialize(application: Application): void {
  // Don't override in FastBoot (server-side) — let Ember's default serialize mode work
  if (typeof FastBoot !== 'undefined') {
    return;
  }

  application.register('service:-dom-builder', {
    create() {
      if (
        typeof document !== 'undefined' &&
        // @ts-expect-error hmm
        globalThis.__boxelRenderMode === 'rehydrate'
      ) {
        console.log('[ember-host] Boxel render mode override: rehydrate');
        return rehydrationBuilder.bind(null);
      } else if (
        typeof document !== 'undefined' &&
        // @ts-expect-error what to do
        globalThis.__boxelRenderMode === 'serialize'
      ) {
        console.log('[ember-host] Boxel render mode override: serialize');
        return serializeBuilder.bind(null);
      } else {
        return clientBuilder.bind(null);
      }
    },
  });
}

export default {
  initialize,
};
