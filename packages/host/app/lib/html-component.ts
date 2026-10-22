import { setComponentManager } from '@ember/component';
import { capabilities } from '@ember/component';
import { setComponentTemplate } from '@ember/component';

import { htmlSafe, type SafeString } from '@ember/template';
import { precompileTemplate } from '@ember/template-compilation';

import { template } from '@ember/template-compiler/runtime';

import { modifier } from 'ember-modifier';

import type { ComponentLike } from '@glint/template';

class _DynamicHTMLComponent {
  constructor(
    readonly component: TopElement,
    readonly attrs: Record<string, string | SafeString>,
    readonly children: Node[],
  ) {}
}

class _SimpleHTMLComponent {
  constructor(readonly htmlString: string) {}
}

export type HTMLComponent = ComponentLike<{ Args: {}; Element: Element }>;

const cache = new Map<string, TopElement>();

export function clearHtmlComponentCache() {
  cache.clear();
}

type TopElement = ComponentLike<{
  Args: { attrs: Record<string, string> };
  Element: Element;
}>;

export function htmlComponent(
  html: string,
  extraAttributes: Record<string, string> = {},
  // Runs on the parsed root before its attributes are read into the template,
  // so a caller can adjust the root's classes without reserializing the HTML.
  transformRoot?: (root: Element) => void,
): HTMLComponent {
  let testContainer = document.createElement('div');
  testContainer.innerHTML = html;
  // Prerendered atom / isolated / head HTML is captured as the render root's
  // innerHTML and so arrives wrapped in the route template's whitespace; only
  // non-blank text counts against the single-root shape.
  let significantNodes = [...testContainer.childNodes].filter(
    (node) => node.nodeType !== Node.TEXT_NODE || node.textContent?.trim(),
  );
  if (
    significantNodes.length === 1 &&
    significantNodes[0].nodeType === Node.ELEMENT_NODE
  ) {
    let cardElement = significantNodes[0] as Element;
    transformRoot?.(cardElement);
    let tagName = cardElement.tagName.toLowerCase();

    let sourceParts: string[] = [];
    let attrs: Record<string, string | SafeString> = {};

    sourceParts.push(`<${tagName} `);

    for (let { name, value } of cardElement.attributes) {
      if (name === 'style') {
        attrs[name] = htmlSafe(value);
      } else {
        attrs[name] = value;
      }
      sourceParts.push(`${name}={{@attrs.${name}}} `);
    }

    for (let [name, value] of Object.entries(extraAttributes)) {
      attrs[name] = value;
      sourceParts.push(`${name}={{@attrs.${name}}} `);
    }

    sourceParts.push(`...attributes />`);

    let source = sourceParts.join('');
    let component: TopElement;
    if (cache.has(source)) {
      component = cache.get(source)!;
    } else {
      component = template(source) as TopElement;
      cache.set(source, component);
    }

    return new _DynamicHTMLComponent(component, attrs, [
      ...cardElement.childNodes,
    ]) as unknown as HTMLComponent;
  } else {
    console.warn(
      `htmlComponent expected exactly one childNode that is a childNode, found ${JSON.stringify(testContainer.childNodes)}`,
    );
    return new _SimpleHTMLComponent(html) as unknown as HTMLComponent;
  }
}

setComponentTemplate(
  precompileTemplate(
    '<this.component @attrs={{this.attrs}} {{withChildren this.children}} ...attributes />',
    {
      strictMode: true,
      scope: () => ({ withChildren }),
    },
  ),
  _DynamicHTMLComponent.prototype,
);

setComponentTemplate(
  precompileTemplate('{{htmlSafe this.htmlString}}', {
    strictMode: true,
    scope: () => ({ htmlSafe }),
  }),
  _SimpleHTMLComponent.prototype,
);

type ComponentManager = ReturnType<Parameters<typeof setComponentManager>[0]>;

class HTMLComponentManager implements ComponentManager {
  capabilities = capabilities('3.13', {});
  static create(_owner: unknown) {
    return new HTMLComponentManager();
  }
  createComponent(
    htmlComponent: _DynamicHTMLComponent | _SimpleHTMLComponent,
    _args: unknown,
  ) {
    return htmlComponent;
  }
  getContext(htmlComponent: _DynamicHTMLComponent | _SimpleHTMLComponent) {
    return htmlComponent;
  }
}

setComponentManager(
  (owner) => HTMLComponentManager.create(owner),
  _DynamicHTMLComponent.prototype,
);

setComponentManager(
  (owner) => HTMLComponentManager.create(owner),
  _SimpleHTMLComponent.prototype,
);

// One HTMLComponent may be mounted in several places at once (a search
// consumer that shows the same entry twice). The parsed nodes are owned by the
// component, and appendChild would move them from the earlier mount into the
// later one, so a mount that finds them already live in the document takes a
// copy. Nodes left inside a torn-down root are disconnected and move freely.
const withChildren = modifier((element: Element, [children]: [Node[]]) => {
  for (let child of children) {
    element.appendChild(child.isConnected ? child.cloneNode(true) : child);
  }
});
