import Modifier from "ember-modifier";
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

interface Signature {
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
  Args: {
    opts?: ShadowDOMOptions
  }
}

interface ModifierSignature {
  element: HTMLElement;
  Args: {
    Positional: [
      setShadow: (shadow: ShadowRoot) => void
    ];
  };
}

export interface ShadowDOMOptions {
  disableShadowDOM?: true
}

const isFastBoot = typeof (globalThis as any).FastBoot !== "undefined";

// TODO when encountering this component as part of card pre-render,
// we'll need to think about how the consumers of this HTML fragment
// will operate. Declarative shadow roots probably won't cut it. Rather
// we'll need to attach shadow roots to these html fragments on the
// fly as we consume them.
export default class ShadowDOM extends Component<Signature> {
  <template>
    {{#if (or isFastBoot this.disableShadowDOM)}}
      <div data-test-shadow-component>
        {{yield}}
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

  get disableShadowDOM() {
    return !!this.args.opts?.disableShadowDOM;
  }
}

class ShadowRootModifier extends Modifier<ModifierSignature> {
  modify(element: HTMLElement, [setShadow]: ModifierSignature["Args"]["Positional"]) {
    const shadow = element.attachShadow({ mode: "open" });
    setShadow(shadow);
  }
}

function or(a: boolean, b: boolean) {
  return a || b;
}
