import Modifier from "ember-modifier";
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { initStyleSheet, attachStyles } from 'https://cardstack.com/base/attach-styles';

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

let css = `
  this {
    display: contents;
  }
`;

export default class ShadowDOM extends Component<Signature> {
  <template>
    <div {{ShadowRootModifier this.setShadow}} {{attachStyles this.styles}} ...attributes data-test-shadow-component>
      {{#if this.shadow}}
        {{#in-element this.shadow}}
          {{yield}}
        {{/in-element}}
      {{/if}}
    </div>
  </template>

  @tracked shadow: ShadowRoot | undefined = undefined;
  styleSheet = initStyleSheet(css);

  setShadow = (shadow: ShadowRoot) => {
    this.shadow = shadow;
  };

  get styles() {
    this.styleSheet?.replaceSync(css);
    return this.styleSheet;
  }
}

class ShadowRootModifier extends Modifier<ModifierSignature> {
  modify(element: HTMLElement, [setShadow]: ModifierSignature["Args"]["Positional"]) {
    const shadow = element.attachShadow({ mode: "open" });
    setShadow(shadow);
  }
}
