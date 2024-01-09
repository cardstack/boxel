import Modifier, { NamedArgs, PositionalArgs } from 'ember-modifier';

interface SetCssVarModifierSignature {
  Args: {
    Named: Record<string, string | undefined>;
    Positional: [];
  };
  Element: HTMLElement;
}

export default class SetCssVarModifier extends Modifier<SetCssVarModifierSignature> {
  async modify(
    element: HTMLElement,
    _positional: PositionalArgs<SetCssVarModifierSignature>,
    entries: NamedArgs<SetCssVarModifierSignature>,
  ): Promise<void> {
    Object.entries(entries)
      .map(([key, val]) => [key.startsWith('--') ? key : `--${key}`, val])
      .filter(([key, val]) => key !== undefined && val !== undefined)
      .forEach(([key, val]) => {
        element.style.setProperty(key!, val!);
      });
  }
}
