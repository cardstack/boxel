import Modifier from "ember-modifier";

interface Signature {
  element: HTMLElement;
  Args: {
    Positional: [model: any, style: string];
  };
}

export class ShadowRoot extends Modifier<Signature> {
  modify(
    element: HTMLElement,
    [model, style]: Signature["Args"]["Positional"]
  ) {
    const shadow = element.attachShadow({ mode: "open" });

    const wrapper = document.createElement("div");
    wrapper.className = model.constructor.name;
    wrapper.innerHTML = element.innerHTML;

    const styles = document.createElement("style");
    styles.innerHTML = style;

    shadow.appendChild(wrapper);
    shadow.appendChild(styles);
  }
}
