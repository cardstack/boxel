import { destroy } from '@ember/destroyable';

import type Owner from '@ember/owner';
// prettier-ignore
// @ts-ignore - no types for @glimmer/runtime
import { renderComponent as glimmerRenderComponent, inTransaction } from '@glimmer/runtime';
// @ts-ignore - no types for @glimmer/validator
import { resetTracking } from '@glimmer/validator';

import { CardError } from '@cardstack/runtime-common/error';

import type { Format } from '@cardstack/base/card-api';

import type { ComponentLike } from '@glint/template';

import type { SimpleElement } from '@simple-dom/interface';

interface Signature {
  Args: {
    format?: Format;
  };
}

type ActiveRender = {
  drop: object;
};

const activeRenders = new WeakMap<SimpleElement, ActiveRender>();

export function render(
  C: ComponentLike<Signature>,
  element: SimpleElement,
  owner: Owner,
  format?: Format,
): void {
  // `renderComponent()` creates a live Glimmer tree. Dropping the DOM nodes
  // without destroying the previous render leaks that tree across rerenders.
  teardown(element);
  removeChildren(element);

  let {
    state: { owner: _owner, builder: _builder, context: _context },
  } = owner.lookup('renderer:-dom') as any;

  let result: ActiveRender | undefined;

  try {
    inTransaction(_context.env, () => {
      let iterator = glimmerRenderComponent(
        _context,
        _builder(_context.env, { element }),
        _owner,
        C,
        { format },
      );
      result = iterator.sync();
    });
  } catch (err: any) {
    resetTracking();
    let error = new CardError(
      `Encountered error rendering HTML for card: ${err.message}`,
    );
    error.additionalErrors = [err];
    throw error;
  }

  if (!result) {
    throw new Error('isolated render did not produce a render result');
  }

  activeRenders.set(element, result);
}

export function teardown(element: SimpleElement): void {
  let activeRender = activeRenders.get(element);
  if (!activeRender) {
    return;
  }
  activeRenders.delete(element);
  destroy(activeRender.drop);
  removeChildren(element);
}

function removeChildren(element: SimpleElement) {
  let child = element.firstChild;
  while (child) {
    element.removeChild(child);
    child = element.firstChild;
  }
}
