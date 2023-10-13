import { getComponentTemplate } from '@ember/component';

import type Owner from '@ember/owner';
// @ts-expect-error
import { createConstRef } from '@glimmer/reference';
// @ts-expect-error
import { renderMain, inTransaction } from '@glimmer/runtime';

import { type ComponentLike } from '@glint/template';

import { CardError } from '@cardstack/runtime-common/error';

import type { SimpleElement } from '@simple-dom/interface';

export function render(
  C: ComponentLike,
  element: SimpleElement,
  owner: Owner,
): void {
  // this needs to be a template-only component because the way we're invoking it	  const root = class RenderComponent extends Component {
  // just grabs the template and would drop any associated class.	    <template>
  const root = <template><C /></template>;

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
    inTransaction(_runtime.env, () => vm._execute());
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

function removeChildren(element: SimpleElement) {
  let child = element.firstChild;
  while (child) {
    element.removeChild(child);
    child = element.firstChild;
  }
}
