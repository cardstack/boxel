import Modifier from "ember-modifier";

interface Signature {
  element: HTMLElement;
  Args: {
    Positional: [label?: string, style?: string];
  };
}

export class ShadowRoot extends Modifier<Signature> {
  modify(
    element: HTMLElement,
    [label, style]: Signature["Args"]["Positional"]
  ) {
    const shadow = element.attachShadow({ mode: "open" });

    const wrapper = document.createElement("div");
    if (label) {
      wrapper.className = label;
    }
    wrapper.innerHTML = element.innerHTML;

    if (style) {
      const styles = document.createElement("style");
      styles.innerHTML = style;
      shadow.appendChild(styles);
    }

    shadow.appendChild(wrapper);
  }
}
