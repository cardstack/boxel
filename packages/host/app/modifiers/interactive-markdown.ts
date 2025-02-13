import Modifier from 'ember-modifier';

export default class InteractiveMarkdownModifier extends Modifier {
  async modify(): Promise<void> {
    let copyButtons = document.querySelectorAll(`.code-copy-button`);
    if (!copyButtons || copyButtons.length === 0) {
      return;
    }
    for (let copyButton of copyButtons) {
      if ((copyButton as HTMLButtonElement).onclick === null) {
        (copyButton as HTMLButtonElement).onclick = (event) => {
          let buttonElement = event.currentTarget as HTMLElement;
          let codeBlock = buttonElement.nextElementSibling;
          if (codeBlock) {
            navigator.clipboard
              .writeText((codeBlock as HTMLPreElement).innerText)
              .then(() => {
                let svg = buttonElement.children[0];
                let copyText = buttonElement.children[1];
                buttonElement.replaceChildren(
                  svg,
                  document.createTextNode('Copied'),
                );
                setTimeout(
                  () => buttonElement.replaceChildren(svg, copyText),
                  2000,
                );
              });
          }
        };
      }
    }
  }
}
