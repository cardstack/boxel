import {
  capabilities,
  setComponentManager,
  setComponentTemplate,
} from '@ember/component';
import { createTemplateFactory } from '@ember/template-factory';

import { decodeScopedCSSRequest } from '@cardstack/runtime-common';

import type {
  CapsuleComponentDefinition,
  CapsuleComponentInstanceHandle,
  CapsuleComponentRuntime,
  CapsuleComponentHandle,
} from './capsule-component-runtime';

import type {
  CapsuleScopeReference,
  CapsuleTemplateBundle,
  CapsuleTemplateDescriptor,
} from './capsule-module-evaluator';
import type { ComponentLike } from '@glint/template';

type ComponentManager = ReturnType<Parameters<typeof setComponentManager>[0]>;

export type CapsuleComponent = ComponentLike<{
  Args: Record<string, unknown>;
  Element: Element;
}>;

export interface CapsuleRenderSlot {
  readonly owner: 'capsule';
  readonly component: CapsuleComponent;
  readonly stylesheets: string[];
}

class _CapsuleComponent {
  constructor(
    readonly runtime: CapsuleComponentRuntime,
    readonly definition: CapsuleComponentDefinition,
  ) {}
}

class CapsuleComponentState {
  constructor(
    readonly runtime: CapsuleComponentRuntime,
    readonly handle: CapsuleComponentInstanceHandle,
    readonly releaseStyles: () => void,
  ) {}
}

class CapsuleComponentManager implements ComponentManager {
  capabilities = capabilities('3.13', {
    destructor: true,
    updateHook: true,
  });

  static create(_owner: unknown) {
    return new CapsuleComponentManager();
  }

  createComponent(
    definition: _CapsuleComponent,
    args: unknown,
  ): CapsuleComponentState {
    let releaseStyles = capsuleStylesheets.retain(
      definition.definition.stylesheets,
    );
    let handle = definition.runtime.createComponent(
      definition.definition,
      namedArguments(args),
    );
    return new CapsuleComponentState(definition.runtime, handle, releaseStyles);
  }

  getContext(component: CapsuleComponentState): object {
    return component.runtime.getContext(component.handle);
  }

  updateComponent(component: CapsuleComponentState, args: unknown): void {
    component.runtime.updateComponent(component.handle, namedArguments(args));
  }

  destroyComponent(component: CapsuleComponentState): void {
    component.runtime.destroyComponent(component.handle);
    component.releaseStyles();
  }
}

function namedArguments(args: unknown): Record<string, unknown> {
  if (
    typeof args !== 'object' ||
    args === null ||
    !('named' in args) ||
    typeof args.named !== 'object' ||
    args.named === null
  ) {
    return {};
  }
  return args.named as Record<string, unknown>;
}

setComponentManager(
  (owner) => CapsuleComponentManager.create(owner),
  _CapsuleComponent.prototype,
);

/** Reify one validated Capsule template graph into private Host definitions. */
export async function createCapsuleRenderSlot(
  runtime: CapsuleComponentRuntime,
  bundle: CapsuleTemplateBundle,
  loadTrustedModule: (
    moduleIdentifier: string,
  ) => Promise<Record<string, unknown>>,
): Promise<CapsuleRenderSlot> {
  let definitions = new Map<string, _CapsuleComponent>();
  let stylesheets = decodedStylesheets(bundle);

  for (let [id, descriptor] of Object.entries(bundle.templates)) {
    validateTemplateDescriptor(descriptor);
    definitions.set(
      id,
      new _CapsuleComponent(runtime, {
        component: id as CapsuleComponentHandle,
        descriptor,
        stylesheets: id === bundle.root ? stylesheets : [],
      }),
    );
  }

  let moduleCache = new Map<string, Record<string, unknown>>();
  let resolveScope = async (reference: CapsuleScopeReference) => {
    switch (reference.kind) {
      case 'component': {
        let definition = definitions.get(reference.component);
        if (!definition) {
          throw new Error(
            `Capsule template references unknown component '${reference.component}'`,
          );
        }
        return definition;
      }
      case 'trusted-export': {
        let module = moduleCache.get(reference.module);
        if (!module) {
          module = await loadTrustedModule(reference.module);
          moduleCache.set(reference.module, module);
        }
        if (!(reference.name in module)) {
          throw new Error(
            `Trusted module '${reference.module}' has no '${reference.name}' export`,
          );
        }
        return module[reference.name];
      }
      case 'value':
        return structuredClone(reference.value);
    }
  };

  for (let [id, descriptor] of Object.entries(bundle.templates)) {
    let definition = definitions.get(id)!;
    let scope = await Promise.all(descriptor.scope.map(resolveScope));
    let template = createTemplateFactory({
      id: `${descriptor.id}-capsule`,
      block: descriptor.block,
      moduleName: descriptor.moduleName,
      scope: () => scope,
      isStrictMode: descriptor.isStrictMode,
    });
    setComponentTemplate(template, definition);
  }

  let root = definitions.get(bundle.root);
  if (!root) {
    throw new Error(`Capsule template bundle has no root '${bundle.root}'`);
  }
  return {
    owner: 'capsule',
    component: root as unknown as CapsuleComponent,
    stylesheets,
  };
}

function validateTemplateDescriptor(
  descriptor: CapsuleTemplateDescriptor,
): void {
  let block: unknown;
  try {
    block = JSON.parse(descriptor.block);
  } catch {
    throw new Error(
      `Capsule template '${descriptor.id}' has invalid wire data`,
    );
  }
  if (!Array.isArray(block)) {
    throw new Error(
      `Capsule template '${descriptor.id}' has invalid wire data`,
    );
  }
}

function decodedStylesheets(bundle: CapsuleTemplateBundle): string[] {
  let result = new Set<string>();
  for (let descriptor of Object.values(bundle.templates)) {
    for (let request of descriptor.stylesheets) {
      let css = decodeScopedCSSRequest(request).css;
      validateCapsuleStylesheet(css);
      result.add(css);
    }
  }
  return [...result];
}

function validateCapsuleStylesheet(css: string): void {
  if (!/\[data-scopedcss-[a-z0-9-]+/i.test(css)) {
    throw new Error('Capsule stylesheet is missing its compiled scope');
  }
  if (/@(?:import|namespace|charset)\b/i.test(css)) {
    throw new Error('Capsule stylesheet contains a global at-rule');
  }
}

interface RetainedStyle {
  count: number;
  element: HTMLStyleElement;
}

class CapsuleStylesheetRegistry {
  private styles = new Map<string, RetainedStyle>();

  retain(stylesheets: string[]): () => void {
    if (typeof document === 'undefined') {
      return () => undefined;
    }
    for (let css of stylesheets) {
      let retained = this.styles.get(css);
      if (retained) {
        retained.count++;
      } else {
        let element = document.createElement('style');
        element.dataset.boxelCapsuleStyle = '';
        element.textContent = css;
        document.head.appendChild(element);
        this.styles.set(css, { count: 1, element });
      }
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      for (let css of stylesheets) {
        let retained = this.styles.get(css);
        if (!retained) {
          continue;
        }
        retained.count--;
        if (retained.count === 0) {
          retained.element.remove();
          this.styles.delete(css);
        }
      }
    };
  }
}

const capsuleStylesheets = new CapsuleStylesheetRegistry();
