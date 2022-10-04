import Modifier from "ember-modifier";
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

interface Signature {
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

interface ModifierSignature {
  element: HTMLElement;
  Args: {
    Positional: [
      setShadow: (shadow: ShadowRoot) => void
    ];
  };
}

export default class ShadowDOM extends Component<Signature> {
  <template>
    <div {{ShadowRootModifier this.setShadow}} ...attributes data-test-shadow-component>
      {{#if this.shadow}}
        {{#in-element this.shadow}}
          {{yield}}
        {{/in-element}}
      {{/if}}
    </div>
  </template>

  @tracked shadow: ShadowRoot | undefined = undefined;

  setShadow = (shadow: ShadowRoot) => {
    this.shadow = shadow;
  };
}

class ShadowRootModifier extends Modifier<ModifierSignature> {
  modify(element: HTMLElement, [setShadow]: ModifierSignature["Args"]["Positional"]) {
    const shadow = element.attachShadow({ mode: "open" });
    setShadow(shadow);
  }
}
