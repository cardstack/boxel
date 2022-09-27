import type { TemplateOnlyComponent } from "@ember/component/template-only";
import Modifier from 'ember-modifier';

interface Signature {
  Element: HTMLElement;
  Args: {
    label?: string;
  };
  Blocks: {
    default: [];
  };
}

const CardContainer: TemplateOnlyComponent<Signature> = (
  <template>
    <div {{ShadowContainer @label}} ...attributes>
      {{yield}}
    </div>
  </template>
);

export default CardContainer;


interface ShadowSignature {
  Element: HTMLElement;
  Args: {
    Positional: [label: string | undefined]
  };
}

class ShadowContainer extends Modifier<ShadowSignature> {
  modify(
    element: HTMLElement,
    [label]: ShadowSignature["Args"]["Positional"]
  ) {
    const shadow = element.attachShadow({ mode: 'open' });
    
    const container = document.createElement('div');
    container.setAttribute('class', 'card');
    container.innerHTML = element.innerHTML;

    if (label) {
      container.classList.add(label);
      const labelDiv = document.createElement('div');
      labelDiv.setAttribute('class', 'card-label');
      labelDiv.textContent = label;
      container.prepend(labelDiv);
    }

    const styles = document.createElement('style');
    styles.textContent = `
      .card {
        position: relative;
        margin-top: 1rem;
        margin-bottom: 1rem;
        border: 1px solid gray;
        border-radius: 10px;
        padding: 2rem 1rem 1rem;
        background-color: white;
        overflow: auto;
      }
      .card-label {
        position: absolute;
        top: 0;
        right: 0;
        background-color: #f4f4f4;
        color: darkgray;
        font-size: 0.9rem;
        font-weight: bold;
        font-family: Arial, Helvetica, sans-serif;
        padding: 0.5em 1em;
      }
    `;
    
    shadow.appendChild(container);
    shadow.appendChild(styles);
  }
}