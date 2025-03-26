import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import cn from '../../../helpers/cn.ts';
import { not } from '../../../helpers/truth-helpers.ts';
import optional from '../../../helpers/optional.ts';
import DropdownArrowDown from '../../../icons/dropdown-arrow-down.gts';

export interface AccordionItemSignature {
  Args: {
    id: string;
    className?: string;
    contentClass?: string;
    isOpen: boolean;
    onClick?: (event: MouseEvent) => void;
  };
  Blocks: {
    content: [];
    header: [];
    title: [];
  };
  Element: HTMLDivElement;
}

const AccordionItem: TemplateOnlyComponent<AccordionItemSignature> = <template>
  <div class={{cn 'accordion-item' @className open=@isOpen}} ...attributes>
    <button
      class='title'
      {{on 'click' (optional @onClick)}}
      disabled={{if @onClick false true}}
      aria-expanded='{{@isOpen}}'
      aria-controls='accordion-item-content-id-{{@id}}'
      id='accordion-item-header-id-{{@id}}'
    >
      <span class='accordion-title-content'>
        <DropdownArrowDown
          class={{cn 'caret' open=@isOpen}}
          width='12'
          height='12'
        />
        {{yield to='title'}}
      </span>
    </button>
    {{yield to='header'}}
  </div>
  <div
    class={{cn 'content' @contentClass open=@isOpen}}
    id='accordion-item-content-id-{{@id}}'
    role='region'
    aria-labelledby='accordion-item-header-id-{{@id}}'
    hidden={{not @isOpen}}
  >
    {{yield to='content'}}
  </div>
  <style scoped>
    .accordion-item {
      --accordion-item-closed-height: var(--boxel-form-control-height);
      --accordion-item-title-font: 500 var(--boxel-font-sm);
      --accordion-item-title-letter-spacing: var(--boxel-lsp-xs);
      --accordion-item-title-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);

      min-height: var(--accordion-item-closed-height);
      display: flex;
    }
    .content {
      flex: 1;
      opacity: 0;
      display: none;
    }
    .content.open {
      display: block;
      opacity: 1;
      overflow-y: auto;
    }
    .title {
      flex-grow: 1;
      display: inline-block;
      gap: var(--boxel-sp-xxs);
      height: inherit;
      padding: var(--accordion-item-title-padding);
      color: inherit;
      font: var(--accordion-item-title-font);
      letter-spacing: var(--accordion-item-title-letter-spacing);
      background-color: transparent;
      border: none;
      text-align: left;
    }
    .title:hover:not(:disabled) {
      cursor: pointer;
    }
    .accordion-title-content {
      margin: auto;
      display: inline-flex;
      align-items: center;
      gap: var(--boxel-sp-xxs);
    }
    .caret {
      align-self: flex-start;
      margin-top: var(--boxel-sp-4xs);
      flex-shrink: 0;
      transform: rotate(-90deg);
      transition: transform;
    }
    .caret.open {
      transform: rotate(0deg);
    }
  </style>
</template>;

export default AccordionItem;
