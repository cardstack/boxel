import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { svgJar } from '../../../helpers/svg-jar';

interface Signature {
  Element: HTMLDetailsElement;
  Args: {
    className: string;
  };
  Blocks: {
    title: [];
    content: [];
  };
}

const AccordionItem: TemplateOnlyComponent<Signature> = <template>
  <details class='accordion-item {{@className}}' ...attributes>
    <summary class='title'>
      <span class='caret'>
        {{svgJar 'dropdown-arrow-down' width='20' height='20'}}
      </span>
      {{yield to='title'}}
    </summary>
    <div class='content'>
      {{yield to='content'}}
    </div>
  </details>
  <style>
    .accordion-item {
      --accordion-item-closed-min-height: 2.5rem;
      --accordion-item-open-min-height: 20rem;
      --accordion-item-border: var(--accordion-border);
      --accordion-item-title-font: 700 var(--boxel-font);
      --accordion-item-title-letter-spacing: var(--boxel-lsp-xs);
      --accordion-item-title-padding: var(--boxel-sp-xs);
      --accordion-item-content-padding: var(--boxel-sp-sm);

      min-height: var(--accordion-item-closed-min-height);
      transition: min-height var(--boxel-transition);
    }
    .accordion-item[open] {
      min-height: var(--accordion-item-open-min-height);
    }
    .accordion-item > .content {
      height: 0;
      transition: height var(--boxel-transition);
    }
    .accordion-item[open] > .content {
      height: max-content;
    }
    .title {
      display: flex;
      padding: var(--accordion-item-title-padding);
      font: var(--accordion-item-title-font);
      letter-spacing: var(--accordion-item-title-letter-spacing);
    }
    .title:hover {
      cursor: pointer;
    }
    ::marker {
      display: none;
      content: '';
    }
    .caret {
      --icon-color: var(--boxel-highlight);
      display: inline-block;
      margin-right: var(--boxel-sp-xxxs);
      width: var(--boxel-icon-sm);
      height: var(--boxel-icon-sm);
      transform: rotate(-90deg);
      transition: transform var(--boxel-transition);
    }
    .accordion-item[open] > .title > .caret {
      transform: rotate(0deg);
    }
    .content {
      padding: var(--accordion-item-content-padding);
      border-top: var(--accordion-item-border);
    }
  </style>
</template>;

export default AccordionItem;
