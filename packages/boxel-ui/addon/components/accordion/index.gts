import Component from '@glimmer/component';

interface Signature {
  Element: HTMLDivElement;
  Blocks: {
    default: [];
  };
}

export default class Accordion extends Component<Signature> {
  <template>
    <div class='accordion' ...attributes>
      {{yield}}
    </div>
    <style>
      .accordion {
        --accordion-border: var(--boxel-border);
        --accordion-border-radius: var(--boxel-border-radius-xl);

        border: var(--accordion-border);
        border-radius: var(--accordion-border-radius);
      }
    </style>
  </template>
}
