import { getComponentTemplate } from '@ember/component';
import { CardError } from "@cardstack/runtime-common/error";
import { type ComponentLike } from '@glint/template';
// @ts-expect-error
import { renderMain, inTransaction } from '@glimmer/runtime';
// @ts-expect-error
import { createConstRef } from '@glimmer/reference';
import type { SimpleElement } from '@simple-dom/interface';
import type Owner from '@ember/owner';

export function render(C: ComponentLike, element: SimpleElement, owner: Owner): void {
  // this needs to be a template-only component because the way we're invoking it
  // just grabs the template and would drop any associated class.
  const root = <template><C/></template>

  // clear any previous render work
  removeChildren(element);

  let { _runtime, _context, _owner, _builder } = owner.lookup('renderer:-dom') as any;
  let self = createConstRef({}, 'this');
  let layout = (getComponentTemplate as any)(root)(_owner).asLayout();
  let iterator = renderMain(_runtime, _context, _owner, self, _builder(_runtime.env, { element }), layout);
  let vm = (iterator as any).vm;
  let initialState = vm.env.debugRenderTree.stack.current;
  let initialStackSize = vm.env.debugRenderTree.stack.stack.length;
  debugger;

  try {
    inTransaction(_runtime.env, () => vm._execute());
  } catch (err: any) {
    // This is to compensate for the commitCacheGroup op code that is not called because
    // of the error being thrown here. we do this so we can keep the TRANSACTION_STACK
    // balanced (which would otherwise cause consumed tags to leak into subsequent frames).
    // I'm not adding this to a "finally" because when there is no error, the VM will 
    // process an op code that will do this organically. It's only when there is an error 
    // that we need to step in and do this by hand.

    // we need to pair a commit with each component that comprises a card hierarchy.
    // This logic will work fine if the error is thrown at the top level card, but if an
    // error is thrown in a nested card I'm unsure if we'll need more commits. If we adjust the
    // component hierarchy required to construct a card we'll need to adjust this appropriately...
    vm.commitCacheGroup(); // card field component
    vm.commitCacheGroup(); // ShadowDOM component
    vm.commitCacheGroup(); // Isolated/Embedded component

    // Unwind the render tree stack until we get back to the initial state
    while (vm.env.debugRenderTree.stack.current!== initialState && vm.env.debugRenderTree.stack.size > 0) {
      vm.env.debugRenderTree.exit();
    }
    if (vm.env.debugRenderTree.stack.size === 0 && initialStackSize > 0) {
      throw new Error(`could not unwind the glimmer render tree stack back to the initial state`);
    }
  
    let error = new CardError(`Encountered error rendering HTML for card: ${err.message}`);
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