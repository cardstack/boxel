import Modifier, { type PositionalArgs } from 'ember-modifier';

interface SetScopedCssSignature {
  Args: {
    Positional: [boolean];
  };
  Element: HTMLElement;
}

export default class SetScopedCss extends Modifier<SetScopedCssSignature> {
  modify(
    element: HTMLElement,
    [toggleScopedCss]: PositionalArgs<SetScopedCssSignature>,
  ): () => void {
    let globalWormholeElement = document.querySelector(
      '#ember-basic-dropdown-wormhole',
    );
    let attributeKeys = Array.from(element.attributes).map((attr) => attr.name);
    let scopedCssKey = attributeKeys.find((attrName) => {
      return attrName.startsWith('data-scopedcss');
    });
    if (scopedCssKey && globalWormholeElement) {
      if (toggleScopedCss === true) {
        globalWormholeElement.setAttribute(scopedCssKey, '');
      } else {
        globalWormholeElement.removeAttribute(scopedCssKey);
      }
    }
    return () => {
      if (scopedCssKey && globalWormholeElement) {
        globalWormholeElement.removeAttribute(scopedCssKey);
      }
    };
  }
}
