import { capabilities, setModifierManager } from '@ember/modifier';

import type { ModifierLike } from '@glint/template';

type Teardown = (() => void) | void;

interface State<E extends Element, P extends unknown[]> {
  fn: (element: E, ...positional: P) => Teardown;
  element?: E;
  teardown?: Teardown;
}

// A modifier made from a function of the element and the modifier's
// positional arguments, as `ember-modifier`'s `modifier` makes one, which
// can't ship on the secure origin (ADR 008 §1.3). The function may return a
// teardown, which runs before the function runs again for new arguments, and
// when the element goes.
export function modifier<E extends Element, P extends unknown[] = []>(
  fn: (element: E, ...positional: P) => Teardown,
): ModifierLike<{ Element: E; Args: { Positional: P } }> {
  let definition = { fn };
  setModifierManager(
    () => ({
      capabilities: capabilities('3.22'),
      createModifier(): State<E, P> {
        return { fn };
      },
      installModifier(
        state: State<E, P>,
        element: E,
        args: { positional: unknown[] },
      ) {
        state.element = element;
        state.teardown = state.fn(element, ...(args.positional as P));
      },
      updateModifier(state: State<E, P>, args: { positional: unknown[] }) {
        state.teardown?.();
        state.teardown = state.fn(state.element!, ...(args.positional as P));
      },
      destroyModifier(state: State<E, P>) {
        state.teardown?.();
      },
    }),
    definition,
  );
  return definition as unknown as ModifierLike<{
    Element: E;
    Args: { Positional: P };
  }>;
}

// Gives the element a `data-test-<name>` attribute, for a name a template
// can't spell out itself because it comes from data.
export const testAttribute = modifier(
  (element: Element, name: string | undefined) => {
    if (!name) {
      return;
    }
    let attribute = `data-test-${name}`;
    element.setAttribute(attribute, '');
    return () => element.removeAttribute(attribute);
  },
);
