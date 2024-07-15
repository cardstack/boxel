import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import Modifier from 'ember-modifier';

export interface Signature {
  Args: {
    css?: string;
    html?: string;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

class RegisterElement extends Modifier<{
  Element: HTMLElement;
  Args: {
    Named: {
      registerElement: (element: HTMLElement) => void;
    };
    Positional: [];
  };
}> {
  modify(
    element: HTMLElement,
    _positional: [],
    { registerElement }: { registerElement: (element: HTMLElement) => void },
  ) {
    registerElement(element);
  }
}

class Prerendered extends Component<Signature> {
  registerElement = (element: HTMLElement) => {
    this.updateStyleTag(element);
  };
  updateStyleTag(element: HTMLElement) {
    // check if the style tag exists, otherwise create it, and update the content
    let styleTag = element.querySelector('style');
    if (!styleTag) {
      styleTag = document.createElement('style');
      element.appendChild(styleTag);
    }
    styleTag.textContent = this.args.css || '';
  }
  <template>
    <div {{RegisterElement registerElement=(fn this.registerElement)}}>
      {{{@html}}}
    </div>

    {{yield}}

    {{! Module not found: Error: @cardstack/boxel-ui is trying to import from style-loader!css-loader!glimmer-scoped-css but that is not one of its explicit dependencies }}
    {{!-- <style unscoped>
      {{@css}}
    </style> --}}
  </template>
}

export default Prerendered;
