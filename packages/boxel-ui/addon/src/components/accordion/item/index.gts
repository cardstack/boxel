import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import cn from '../../../helpers/cn.ts';
import optional from '../../../helpers/optional.ts';
import AccordionIcon from '../../../icons/dropdown-arrow-down.gts';

export interface AccordionItemSignature {
  Args: {
    className?: string;
    contentClass?: string;
    disabled?: boolean;
    id: string;
    isOpen: boolean;
    onClick?: (event: Event) => void;
  };
  Blocks: {
    content: [];
    title: [];
  };
  Element: HTMLDivElement;
}

const AccordionItem: TemplateOnlyComponent<AccordionItemSignature> = <template>
  <div class={{cn 'accordion-item' @className open=@isOpen}} ...attributes>
    <h3 class='accordion-item-title'>
      <button
        class='accordion-item-trigger'
        {{on 'click' (optional @onClick)}}
        id={{@id}}
        aria-controls='section-{{@id}}'
        aria-expanded='{{@isOpen}}'
        aria-disabled={{@disabled}}
        disabled={{@disabled}}
      >
        <AccordionIcon class='accordion-item-icon' width='10' height='10' />
        {{yield to='title'}}
      </button>
    </h3>
    <div
      class={{cn 'accordion-item-content' @contentClass}}
      data-state={{if @isOpen 'open' 'closed'}}
      id='section-{{@id}}'
      role='region'
      aria-labelledby={{@id}}
    >
      {{#if @isOpen}}
        {{yield to='content'}}
      {{/if}}
    </div>
  </div>
  <style scoped>
    @layer boxelComponentL1 {
      .accordion-item {
        --accordion-item-title-min-height: var(--boxel-form-control-height);
        --accordion-item-content-min-height: var(--boxel-form-control-height);
        --accordion-item-trigger-padding: var(--boxel-sp-xs);
        --accordion-icon-rotation: rotate(-90deg);
        --accordion-transition: 200ms ease-out;
      }
      .accordion-item.open {
        --accordion-icon-rotation: rotate(0deg);
      }
      .accordion-item-title {
        margin: 0;
        font-weight: var(
          --accordion-title-font-weight,
          var(--boxel-font-weight-semibold)
        );
        font-size: inherit;
        line-height: inherit;
        letter-spacing: inherit;
        min-height: var(--accordion-item-title-min-height);
      }
      .accordion-item-trigger {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        padding: var(--accordion-item-trigger-padding);
        color: inherit;
        background-color: transparent;
        border: none;
        text-align: left;
        width: 100%;
        max-width: 100%;
      }
      .accordion-item-trigger:focus-visible {
        outline-color: var(--ring, var(--boxel-highlight));
      }
      .accordion-item-trigger:hover:not(:disabled) {
        cursor: pointer;
      }
      .accordion-item-trigger:disabled {
        opacity: 0.5;
      }
      .accordion-item-icon {
        flex-shrink: 0;
        transform: var(--accordion-icon-rotation);
        transition: transform var(--accordion-transition);
      }
      .accordion-item-content {
        overflow: hidden;
      }
      .accordion-item-content[data-state='closed'] {
        animation: slideUp var(--accordion-transition);
      }
      .accordion-item-content[data-state='open'] {
        min-height: var(--accordion-item-content-min-height);
        animation: slideDown var(--accordion-transition);
      }
    }

    @keyframes slideDown {
      from {
        min-height: 0;
        height: 0;
      }
      to {
        min-height: var(--accordion-item-content-min-height);
        height: max-content;
      }
    }

    @keyframes slideUp {
      from {
        height: max-content;
        min-height: var(--accordion-item-content-min-height);
      }
      to {
        height: 0;
        min-height: 0;
      }
    }
  </style>
</template>;

export default AccordionItem;
