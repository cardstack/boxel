import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

interface Signature {
  Args: {
    css?: string;
    html?: string;
  };
  Blocks: {
    default: [];
  };
}

let insertStyleElement = modifier((element, [css]: [string | undefined]) => {
  if (css) {
    let styleElement = document.querySelector(
      `style[data-boxel-prerendered-style='${guidFor(element)}']`,
    );

    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.setAttribute(
        'data-boxel-prerendered-style',
        guidFor(element),
      );
      document.head.appendChild(styleElement);
    }

    styleElement.textContent = css;
  }
});

export default class Prerendered extends Component<Signature> {
  <template>
    <invalid {{insertStyleElement @css}}></invalid>

    {{{@html}}}

    {{yield}}
  </template>
}
