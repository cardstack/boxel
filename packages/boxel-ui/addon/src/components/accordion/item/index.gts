import ChevronRight from '@cardstack/boxel-icons/chevron-right';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import cn from '../../../helpers/cn.ts';
import optional from '../../../helpers/optional.ts';

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
  <div
    class={{cn 'boxel-accordion-item' @className open=@isOpen}}
    ...attributes
  >
    <h3 class='boxel-accordion-item-title'>
      <button
        class='boxel-accordion-item-trigger'
        {{on 'click' (optional @onClick)}}
        id={{@id}}
        aria-controls='section-{{@id}}'
        aria-expanded={{@isOpen}}
        disabled={{@disabled}}
      >
        <ChevronRight
          class='boxel-accordion-item-icon'
          width='14'
          height='14'
        />
        {{yield to='title'}}
      </button>
    </h3>
    <div
      class={{cn 'boxel-accordion-item-content' @contentClass}}
      data-state={{if @isOpen 'open' 'closed'}}
      id='section-{{@id}}'
      role='region'
      aria-labelledby={{@id}}
      aria-hidden={{if @isOpen 'false' 'true'}}
    >
      <div class='boxel-accordion-item-content-inner'>
        {{yield to='content'}}
      </div>
    </div>
  </div>
  <style scoped>
    @layer boxelComponentL1 {
      .boxel-accordion-item:not(:first-child) {
        border-top: var(--boxel-accordion-item-border, var(--accordion-border));
      }

      .boxel-accordion-item-title {
        margin: 0;
        font-weight: var(
          --boxel-accordion-title-font-weight,
          var(--boxel-font-weight-semibold)
        );
        font-size: inherit;
        line-height: inherit;
        letter-spacing: inherit;
      }

      .boxel-accordion-item-trigger {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        width: 100%;
        max-width: 100%;
        min-height: var(
          --boxel-accordion-trigger-min-height,
          var(--boxel-form-control-height)
        );
        padding-block: var(
          --boxel-accordion-trigger-padding-block,
          var(--boxel-sp-xs)
        );
        padding-inline: var(--boxel-accordion-trigger-padding-inline, 0);
        color: inherit;
        background-color: transparent;
        border: none;
        text-align: start;
      }
      .boxel-accordion-item-trigger:focus-visible {
        outline-color: var(--ring, var(--boxel-highlight));
      }
      .boxel-accordion-item-trigger:hover:not(:disabled) {
        cursor: pointer;
      }
      .boxel-accordion-item-trigger:disabled {
        opacity: 0.5;
      }

      .boxel-accordion-item-icon {
        flex-shrink: 0;
      }
      [aria-expanded] .boxel-accordion-item-icon {
        transform: rotate(90deg);
      }

      .boxel-accordion-item-content {
        display: grid;
        grid-template-rows: 0fr;
      }
      .boxel-accordion-item-content[data-state='open'] {
        grid-template-rows: 1fr;
      }
      .boxel-accordion-item-content-inner {
        overflow: hidden;
      }

      @media (prefers-reduced-motion: no-preference) {
        .boxel-accordion-item {
          --_bai-transition: var(--boxel-accordion-transition, 200ms ease-out);
        }

        .boxel-accordion-item-icon {
          transition: transform var(--_bai-transition);
        }

        .boxel-accordion-item-content {
          transition: grid-template-rows var(--_bai-transition);
        }
        .boxel-accordion-item-content-inner {
          transition: opacity var(--_bai-transition);
          opacity: 0;
        }
        .boxel-accordion-item-content[data-state='open']
          .boxel-accordion-item-content-inner {
          opacity: 1;
        }
      }
    }
  </style>
</template>;

export default AccordionItem;
