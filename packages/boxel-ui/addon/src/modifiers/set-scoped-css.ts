import Modifier, { type PositionalArgs } from 'ember-modifier';

interface SetScopedCssSignature {
  Args: {
    Positional: [boolean]; //We pass in an argument to toggle the scoped css via the opening and closing of dropdown
  };
  Element: HTMLElement;
}

// The point of this modifier is to set the data-scopedcss attribute on the
// ember-basic-dropdown-wormhole which exists globally at the top of the DOM (where EmberBasicDropdown component exists)

// For context, the ember-basic-dropdown component makes use of a pattern of placing a placeholder divs at the top of the DOM to enable floating dropdowns
// If these placeholder divs are placed locally, it is likely that these floating dropdowns may be clipped by parent containers

// This modifier dynamically scopes the css of your template to the global wormhole element, ie only when you open trigger a dropdown
export default class SetScopedCss extends Modifier<SetScopedCssSignature> {
  modify(
    element: HTMLElement,
    [toggleScopedCss]: PositionalArgs<SetScopedCssSignature>,
  ): () => void {
    debugger;
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
