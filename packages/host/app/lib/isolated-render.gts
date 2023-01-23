import { getComponentTemplate } from '@ember/component';
import { type ComponentLike } from '@glint/template';
import type Owner from '@ember/owner';
// @ts-expect-error
import { renderMain, inTransaction } from '@glimmer/runtime';
// @ts-expect-error
import { createConstRef } from '@glimmer/reference';
import type { SimpleElement } from '@simple-dom/interface';

export function render(C: ComponentLike, element: SimpleElement, owner: Owner): void {
  // this needs to be a template-only component because the way we're invoking it
  // just grabs the template and would drop any associated class.
  const root = <template><C/></template>

  let { _runtime, _context, _owner, _builder } = owner.lookup('renderer:-dom') as any;
  let self = createConstRef({}, 'this');
  let layout = (getComponentTemplate as any)(root)(_owner).asLayout();
  let iterator = renderMain(_runtime, _context, _owner, self, _builder(_runtime.env, { element }), layout);
  let vm = (iterator as any).vm;
  let initialState = vm.env.debugRenderTree.stack.current;

  try {
    inTransaction(_runtime.env, () => vm._execute());
  } catch (err) {
    console.warn(err);
    // This is to compensate for the commitCacheGroup op code that is not called because
    // of the error being thrown here. we do this so we can keep the TRANSACTION_STACK
    // balanced (which would otherwise cause consumed tags to leak into subsequent frames).
    // My assumption here is that it is specifically always going to be the component that
    // we wrap in our `root` whose cache group never gets committed when there is an error.
    // I'm not adding this to a "finally" because when there is no error, the VM will 
    // process an op code that will do this organically. It's only when there is an error 
    // that we need to step in and do this by hand.
    vm.commitCacheGroup();

    // Unwind the render tree stack until we get back to the initial state
    while (vm.env.debugRenderTree.stack.current!== initialState && vm.env.debugRenderTree.stack.size > 0) {
      vm.env.debugRenderTree.exit();
    }
    if (vm.env.debugRenderTree.stack.size === 0) {
      throw new Error(`could not unwind the glimmer render tree stack back to the initial state`);
    }


    // TODO we need to send some kind of signal to the caller to indicate that the render failed
  }
}
