import Modifier, { type NamedArgs, type PositionalArgs } from 'ember-modifier';

interface SetCssVarModifierSignature {
  Args: {
    Named: Record<string, string | undefined>;
    Positional: [];
  };
  Element: HTMLElement;
}

// Sets each named custom property on the element through the CSSOM. A
// property this modifier set is removed when its value becomes `undefined`,
// so a cleared argument falls back to the stylesheet's value.
export default class SetCssVarModifier extends Modifier<SetCssVarModifierSignature> {
  private written = new Set<string>();

  async modify(
    element: HTMLElement,
    _positional: PositionalArgs<SetCssVarModifierSignature>,
    entries: NamedArgs<SetCssVarModifierSignature>,
  ): Promise<void> {
    for (let [name, value] of Object.entries(entries)) {
      let property = name.startsWith('--') ? name : `--${name}`;
      if (value !== undefined) {
        element.style.setProperty(property, value);
        this.written.add(property);
      } else if (this.written.has(property)) {
        element.style.removeProperty(property);
        this.written.delete(property);
      }
    }
  }
}
