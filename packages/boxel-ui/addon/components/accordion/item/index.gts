import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import cn from '@cardstack/boxel-ui/helpers/cn';

export interface AccordionItemSignature {
  Element: HTMLElement;
  Args: {
    isOpen: boolean;
    onClick: (event: MouseEvent) => void;
    className?: string;
  };
  Blocks: {
    title: [];
    content: [];
  };
}

const AccordionItem: TemplateOnlyComponent<AccordionItemSignature> = <template>
  <li class={{cn 'accordion-item' @className open=@isOpen}} ...attributes>
    <header class='title' {{on 'click' @onClick}}>
      <span class='caret'>
        {{svgJar 'dropdown-arrow-down' width='20' height='20'}}
      </span>
      {{yield to='title'}}
    </header>
    <div class='content'>
      {{yield to='content'}}
    </div>
  </li>
  <style>
    .accordion-item {
      --accordion-item-closed-min-height: 2.5rem;
      --accordion-item-open-min-height: var(
        --item-open-min-height,
        var(--accordion-default-item-height)
      );
      --accordion-item-border: var(--accordion-border);
      --accordion-item-title-font: 700 var(--boxel-font);
      --accordion-item-title-letter-spacing: var(--boxel-lsp-xs);
      --accordion-item-title-padding: var(--boxel-sp-xs);

      display: grid;
      grid-template-rows: min-content 1fr;
      min-height: var(--accordion-item-closed-min-height);
    }
    .accordion-item.open {
      flex-grow: 1;
      min-height: var(--accordion-item-open-min-height);
    }
    .accordion-item > .content {
      height: 0;
      overflow: hidden;
    }
    .accordion-item.open > .content {
      height: 100%;
      overflow-y: auto;
      border-top: var(--accordion-item-border);
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
    }
    .accordion-item.open > .title > .caret {
      transform: rotate(0deg);
    }
  </style>
</template>;

export default AccordionItem;
