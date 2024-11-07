import { getComponentTemplate } from '@ember/component';

import type Owner from '@ember/owner';
import { getOwner } from '@ember/owner';
import Component from '@glimmer/component';
// @ts-expect-error
import { createConstRef } from '@glimmer/reference';
// @ts-expect-error
import { renderMain, inTransaction } from '@glimmer/runtime';

import { type ComponentLike } from '@glint/template';

import { modifier } from 'ember-modifier';

import { tracked } from 'tracked-built-ins';

import { CardError } from '@cardstack/runtime-common/error';

function render<Params>(
  element: Element,
  owner: Owner,
  Content: ComponentLike<{ Args: { params: Params } }>,
  params: Params,
): { rerender: () => void } {
  // this needs to be a template-only component because the way we're invoking it
  // just grabs the template and would drop any associated class.
  const root = <template><Content @params={{params}} /></template>;

  // clear any previous render work
  removeChildren(element);

  let { _runtime, _context, _owner, _builder } = owner.lookup(
    'renderer:-dom',
  ) as any;
  let self = createConstRef({}, 'this');
  let layout = (getComponentTemplate as any)(root)(_owner).asLayout();
  let iterator = renderMain(
    _runtime,
    _context,
    _owner,
    self,
    _builder(_runtime.env, { element }),
    layout,
  );
  let vm = (iterator as any).vm;

  try {
    let result: any;
    inTransaction(_runtime.env, () => {
      result = vm._execute();
    });
    return {
      rerender() {
        // NEXT: this needs to get wrapped with our own inTransaction just like the initial render so it doesn't interact with the default tracking frames.
        result.rerender({ alwaysRevalidate: false });
      },
    };
  } catch (err: any) {
    // This is to compensate for the commitCacheGroup op code that is not called because
    // of the error being thrown here. we do this so we can keep the TRANSACTION_STACK
    // balanced (which would otherwise cause consumed tags to leak into subsequent frames).
    // I'm not adding this to a "finally" because when there is no error, the VM will
    // process an op code that will do this organically. It's only when there is an error
    // that we need to step in and do this by hand. Within the vm[STACKS] is a the stack
    // for the cache group. We need to call a commit for each item in this stack.
    let vmSymbols = Object.fromEntries(
      Object.getOwnPropertySymbols(vm).map((s) => [s.toString(), s]),
    );
    let stacks = vm[vmSymbols['Symbol(STACKS)']];
    let stackSize = stacks.cache.stack.length;
    for (let i = 0; i < stackSize; i++) {
      vm.commitCacheGroup();
    }

    let error = new CardError(
      `Encountered error rendering HTML for card: ${err.message}`,
    );
    error.additionalErrors = [err];
    throw error;
  }
}

function removeChildren(element: Element) {
  let child = element.firstChild;
  while (child) {
    element.removeChild(child);
    child = element.firstChild;
  }
}

export default class ErrorTrap<T> extends Component<{
  Args: {
    content: ComponentLike<{ Args: { params: T } }>;
    params: T;
  };
}> {
  @tracked failed = false;

  renderer: { rerender(): void } | undefined;

  attach = modifier((element) => {
    try {
      if (this.renderer) {
        this.renderer.rerender();
      } else {
        this.renderer = render(
          element,
          getOwner(this)!,
          this.args.content,
          this.args.params,
        );
      }
      this.failed = false;
    } catch (err) {
      debugger;
      removeChildren(element);
      this.failed = true;
      this.renderer = undefined;
    }
  });

  <template>
    <div {{this.attach}} />
    {{#if this.failed}}
      <div data-test-error-trap>Something went wrong</div>
    {{/if}}
  </template>
}
