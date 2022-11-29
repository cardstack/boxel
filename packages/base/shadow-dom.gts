import Component from '@glimmer/component';

interface Signature {
  Element: HTMLElement;
  Blocks: {
    default: [];
  };
}

export default class ShadowDOM extends Component<Signature> {
  <template>
    {{ (this.createShadowRoot) }}
    {{#in-element this.shadowRoot}}
      {{yield}}
    {{/in-element}}
  </template>

  shadowRoot!: ShadowRoot; // this is synchronously created before in-element tries to render into it
  stableElement: HTMLElement | undefined;

  createShadowRoot = () => {
    if (!this.stableElement) {
      this.stableElement = document.createElement('div');
      this.shadowRoot = this.stableElement.attachShadow({ mode: 'open' });
    }
    return this.stableElement;
  };
}
