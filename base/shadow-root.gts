import Modifier from "ember-modifier";

interface Signature {
  element: HTMLElement;
  Args: {
    Positional: [label?: string, styles?: string];
  };
}

export class ShadowRootModifier extends Modifier<Signature> {
  modify(
    element: HTMLElement,
    [label, styles]: Signature["Args"]["Positional"]
  ) {
    const shadow = element.attachShadow({ mode: "open" });

    const wrapper = document.createElement("div");
    if (label) {
      wrapper.className = label;
    }
    if (styles) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(styles);
      shadow.adoptedStyleSheets = [sheet];
    }

    wrapper.innerHTML += element.innerHTML;
    shadow.appendChild(wrapper);
  }
}
