import { setComponentManager } from '@ember/component';
import { capabilities } from '@ember/component';
import { setComponentTemplate } from '@ember/component';

import templateOnly from '@ember/component/template-only';
import { htmlSafe } from '@ember/template';
import { precompileTemplate } from '@ember/template-compilation';

import { ComponentLike } from '@glint/template';
import { modifier } from 'ember-modifier';

import { compiler } from '@cardstack/runtime-common/etc';

class _DynamicHTMLComponent {
  constructor(
    readonly component: TopElement,
    readonly attrs: Record<string, string>,
    readonly children: Node[],
  ) {}
}

class _SimpleHTMLComponent {
  constructor(readonly htmlString: string) {}
}

export type HTMLComponent = ComponentLike<{ Args: {}; Element: Element }>;

const cache = new Map<string, TopElement>();

type TopElement = ComponentLike<{
  Args: { attrs: Record<string, string> };
  Element: Element;
}>;

export function htmlComponent(html: string): HTMLComponent {
  let testContainer = document.createElement('div');
  testContainer.innerHTML = html;
  if (
    testContainer.childNodes.length === 1 &&
    testContainer.children.length === 1
  ) {
    let cardElement = testContainer.children[0];
    let tagName = cardElement.tagName.toLowerCase();

    let sourceParts: string[] = [];
    let attrs: Record<string, string> = {};

    sourceParts.push(`<${tagName} `);

    for (let { name, value } of cardElement.attributes) {
      attrs[name] = value;
      sourceParts.push(`${name}={{@attrs.${name}}} `);
    }

    sourceParts.push(`...attributes />`);

    let source = sourceParts.join('');
    let component: TopElement;
    if (cache.has(source)) {
      component = cache.get(source)!;
    } else {
      component = setComponentTemplate(
        compiler.compile(source, { strictMode: true }),
        templateOnly(),
      ) as TopElement;
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

const withChildren = modifier((element: Element, [children]: [Node[]]) => {
  for (let child of children) {
    element.appendChild(child);
  }
});
