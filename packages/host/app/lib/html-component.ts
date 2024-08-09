import { setComponentManager } from '@ember/component';
import { capabilities } from '@ember/component';
import { setComponentTemplate } from '@ember/component';
import { htmlSafe } from '@ember/template';

import { precompileTemplate } from '@ember/template-compilation';

import { ComponentLike } from '@glint/template';

class _HTMLComponent {
  constructor(readonly html: string) {}
}

export type HTMLComponent = ComponentLike<{ Args: {} }>;
export function htmlComponent(html: string): HTMLComponent {
  return new _HTMLComponent(html) as unknown as HTMLComponent;
}

setComponentTemplate(
  precompileTemplate('{{htmlSafe this.html}}', {
    strictMode: true,
    scope: () => ({ htmlSafe }),
  }),
  _HTMLComponent.prototype,
);

type ComponentManager = ReturnType<Parameters<typeof setComponentManager>[0]>;

class HTMLComponentManager implements ComponentManager {
  capabilities = capabilities('3.13', {});
  static create(_owner: unknown) {
    return new HTMLComponentManager();
  }
  createComponent(htmlComponent: _HTMLComponent, _args: unknown) {
    return htmlComponent;
  }
  getContext(htmlComponent: _HTMLComponent) {
    return htmlComponent;
  }
}

setComponentManager(
  (owner) => HTMLComponentManager.create(owner),
  _HTMLComponent.prototype,
);
