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

const isFastBoot = typeof (globalThis as any).FastBoot !== "undefined";

export default class ShadowDOM extends Component<Signature> {
  <template>
    {{#if isFastBoot}}
      <div data-test-shadow-component>
        <template shadowroot="open">
          {{yield}}
        </template>
      </div>
    {{else}}
      <div {{ShadowRootModifier this.setShadow}} data-test-shadow-component>
        {{#if this.shadow}}
          {{#in-element this.shadow}}
            {{yield}}
          {{/in-element}}
        {{/if}}
      </div>
    {{/if}}
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
