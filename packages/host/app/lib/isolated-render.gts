import { getComponentTemplate } from '@ember/component';

import type Owner from '@ember/owner';
// @ts-expect-error
import { createConstRef } from '@glimmer/reference';
// @ts-expect-error
import { renderMain, inTransaction } from '@glimmer/runtime';
// @ts-expect-error
import { resetTracking } from '@glimmer/validator';

import { CardError } from '@cardstack/runtime-common/error';

import type { Format } from 'https://cardstack.com/base/card-api';

import type { ComponentLike } from '@glint/template';

import type { SimpleElement } from '@simple-dom/interface';

interface Signature {
  Args: {
    format?: Format;
  };
}

export function render(
  C: ComponentLike<Signature>,
  element: SimpleElement,
  owner: Owner,
  format?: Format,
): void {
  // this needs to be a template-only component because the way we're invoking it
  // just grabs the template and would drop any associated class.
  const root = <template><C @format={{format}} /></template>;

  // clear any previous render work
  removeChildren(element);

  let {
    state: { owner: _owner, builder: _builder, context: _context },
  } = owner.lookup('renderer:-dom') as any;
  let self = createConstRef({}, 'this');
  let layout = (getComponentTemplate as any)(root)(_owner).asLayout();

  let iterator = renderMain(
    _context,
    _owner,
    self,
    _builder(_context.env, { element }),
    layout,
  );
  let vm = (iterator as any).vm;

  try {
    inTransaction(_context.env, () => vm._execute());
  } catch (err: any) {
    resetTracking();
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
