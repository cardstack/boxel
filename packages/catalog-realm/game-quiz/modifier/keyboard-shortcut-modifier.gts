import Modifier, { NamedArgs } from 'ember-modifier';

type KeyboardShortcutModifierSignature = {
  // Keyboard shortcut modifier signature
  Args: {
    Positional: [];
    Named: {
      onKeydown?: (event: KeyboardEvent) => void;
      enabled?: boolean;
      autoFocus?: boolean;
      focusSelector?: string;
      skipTabIndex?: boolean;
    };
  };
  Element: HTMLElement;
};

// Proper Glimmer modifier for keyboard shortcuts
export class KeyboardShortcutModifier extends Modifier<KeyboardShortcutModifierSignature> {
  modify(
    element: HTMLElement,
    _positional: [],
    named: NamedArgs<KeyboardShortcutModifierSignature>,
  ) {
    const {
      onKeydown,
      enabled = true,
      autoFocus = true,
      focusSelector,
      skipTabIndex = false,
    } = named;

    if (!enabled || typeof onKeydown !== 'function') {
      return;
    }

    const target = focusSelector
      ? element.querySelector<HTMLElement>(focusSelector)
      : element;

    if (!target) {
      return;
    }

    // Set tabindex to make element focusable
    if (!skipTabIndex && !target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '0');
    }

    // Add event listener using Glimmer's lifecycle
    target.addEventListener('keydown', onKeydown);

    // Auto-focus for immediate keyboard interaction
    if (autoFocus && document.activeElement !== target) {
      target.focus({ preventScroll: true });
    }

    // Return cleanup function - Glimmer will call this on teardown
    return () => {
      target.removeEventListener('keydown', onKeydown);
    };
  }
}
