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
      // Debug: log blocks at boxel-root level
      if (this.element?.id === 'boxel-root') {
        let stack = new Error().stack?.split('\n').slice(1, 6).join('\n');
        console.log(`[serialize] __openBlock depth=${depth} at boxel-root\nstack:`, stack);
      }
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
      return nextSibling === null
        ? element.lastChild
        : nextSibling.previousSibling;
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

// Wraps the standard rehydrationBuilder with a fix for Glimmer's handling
// of empty-text markers (<!--% %-->).  When __appendText("") encounters a
// % % comment, the stock rehydrate builder removes it and recurses via
// this.__appendText("").  The recursive call then hits the next candidate
// (typically a close-block marker <!--%-b:N%-->) and triggers clearMismatch,
// causing the entire subtree to be re-rendered.
//
// The fix intercepts this case: when __appendText("") finds a % % comment,
// it replaces the comment with an empty text node in-place (preserving DOM
// position for bounds tracking) and advances the candidate pointer past it.
function fixedRehydrationBuilder(env: any, cursor: any) {
  let builder = rehydrationBuilder(env, cursor);
  let origAppendText = builder.__appendText.bind(builder);
  let origClearMismatch = builder.clearMismatch.bind(builder);
  let origOpenBlock = builder.__openBlock.bind(builder);

  // Log the initial cursor state
  let cursorEl = builder.currentCursor?.element;
  let firstChild = cursorEl?.firstChild;
  console.log(
    '[rehydration] Builder created. cursor element:',
    cursorEl?.tagName,
    cursorEl?.id,
    'firstChild:',
    firstChild?.nodeType,
    firstChild?.nodeName,
    firstChild?.nodeType === 8
      ? firstChild.nodeValue
      : firstChild?.nodeType === 3
        ? JSON.stringify(firstChild.nodeValue?.slice(0, 50))
        : firstChild?.outerHTML?.slice(0, 80),
    'candidate:',
    builder.currentCursor?.candidate?.nodeType,
    builder.currentCursor?.candidate?.nodeName,
  );

  builder.clearMismatch = function (candidate: any) {
    console.warn(
      '[rehydration] MISMATCH at',
      candidate?.nodeName,
      candidate?.nodeType === 8
        ? candidate.nodeValue
        : candidate?.nodeType === 3
          ? 'text:' + JSON.stringify(candidate.nodeValue?.slice(0, 80))
          : candidate?.outerHTML?.slice(0, 120),
      'parent:',
      candidate?.parentNode?.tagName,
      candidate?.parentNode?.id,
    );
    console.trace('[rehydration] clearMismatch stack');
    return origClearMismatch(candidate);
  };

  let openBlockCount = 0;
  builder.__openBlock = function () {
    openBlockCount++;
    let candidate = this.currentCursor?.candidate;
    let isRootLevel =
      candidate?.parentNode?.id === 'boxel-root' ||
      this.currentCursor?.element?.id === 'boxel-root';
    if (isRootLevel) {
      let stack = new Error().stack?.split('\n').slice(1, 8).join('\n');
      console.log(
        `[rehydration] __openBlock #${openBlockCount} candidate:`,
        candidate?.nodeType,
        candidate?.nodeName,
        candidate?.nodeType === 8
          ? candidate.nodeValue
          : candidate?.nodeType === 3
            ? 'text:' + JSON.stringify(candidate.nodeValue?.slice(0, 50))
            : candidate?.outerHTML?.slice(0, 80),
        '\nstack:', stack,
      );
    }
    return origOpenBlock();
  };

  builder.__appendText = function (string: string) {
    let candidate = this.currentCursor?.candidate;
    if (
      string === '' &&
      candidate &&
      candidate.nodeType === 8 &&
      candidate.nodeValue === '% %'
    ) {
      let textNode = document.createTextNode('');
      let parent = candidate.parentNode!;
      let next = candidate.nextSibling;
      parent.replaceChild(textNode, candidate);
      this.currentCursor.candidate = next;
      return textNode;
    }
    // When __appendText is called with whitespace-only content but the
    // candidate is an element node (not a text node or comment), the
    // serialized HTML has interstitial whitespace between block markers
    // that was consumed during marker processing.  Instead of triggering
    // clearMismatch (which destroys the remaining subtree), insert a
    // whitespace text node before the element — this preserves DOM
    // identity for the element and its descendants.
    if (
      string.trim() === '' &&
      candidate &&
      candidate.nodeType === 1 // Element node
    ) {
      let textNode = document.createTextNode(string);
      candidate.parentNode!.insertBefore(textNode, candidate);
      // Don't advance candidate — the element is still next
      return textNode;
    }
    // Debug: log any case where we're about to call origAppendText with an element candidate
    if (candidate && candidate.nodeType === 1) {
      console.warn(
        '[rehydration] __appendText fallthrough to orig with element candidate!',
        'string:', JSON.stringify(string),
        'string.trim()===empty:', string.trim() === '',
        'candidate:', candidate.nodeName, candidate.outerHTML?.slice(0, 120),
      );
    }
    return origAppendText(string);
  };

  return builder;
}

export function initialize(application: Application): void {
  // Don't override in FastBoot (server-side) — let Ember's default serialize mode work
  if (typeof FastBoot !== 'undefined') {
    return;
  }

  application.register('service:-dom-builder', {
    create() {
      // Allow ?serialize query param to force serialize mode for debugging
      if (
        typeof document !== 'undefined' &&
        window.location?.search?.includes('serialize')
      ) {
        console.log(
          '[ember-host] Boxel render mode override: serialize (via query param)',
        );
        return serializeBuilder.bind(null);
      } else if (
        typeof document !== 'undefined' &&
        // @ts-expect-error hmm
        globalThis.__boxelRenderMode === 'rehydrate'
      ) {
        console.log('[ember-host] Boxel render mode override: rehydrate!');
        return fixedRehydrationBuilder.bind(null);
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
