import Modifier from 'ember-modifier';

export default class InteractiveMarkdownModifier extends Modifier {
  async modify(element: Element): Promise<void> {
    let codeBlocks = document.querySelectorAll(
      `#${element.id} pre[data-codeblock]`,
    );
    if (!codeBlocks) {
      return;
    }

    for (let codeBlock of codeBlocks) {
      let copyButton = document.createElement('button') as HTMLButtonElement;
      copyButton.setAttribute('class', 'code-copy-button');
      copyButton.onclick = () =>
        navigator.clipboard.writeText((codeBlock as HTMLPreElement).innerText);
      copyButton.insertBefore(createCopyIcon(), null);
      let text = document.createElement('span') as HTMLSpanElement;
      text.setAttribute('class', 'copy-text');
      text.innerText = 'Copy to clipboard';
      copyButton.insertBefore(text, null);
      codeBlock.parentElement?.insertBefore(copyButton, codeBlock);
    }
  }
}

// not sure how we could use a component here instead, so using the raw HTML
function createCopyIcon() {
  let html = `<svg
    xmlns='http://www.w3.org/2000/svg'
    width='16'
    height='16'
    fill='none'
    stroke='currentColor'
    stroke-linecap='round'
    stroke-linejoin='round'
    stroke-width='3'
    class='lucide lucide-copy'
    viewBox='0 0 24 24'
    ...attributes
  ><rect width='14' height='14' x='8' y='8' rx='2' ry='2' /><path
      d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
    /></svg>`;
  const template = document.createElement('template');
  template.innerHTML = html;
  let copyIcon = template.content.childNodes.item(0) as HTMLElement;
  copyIcon.setAttribute('role', 'presentation');
  copyIcon.setAttribute('aria-hidden', 'true');
  return copyIcon;
}
