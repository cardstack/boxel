import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import type { ComponentLike } from '@glint/template';
import AccordionItem, { type AccordionItemSignature } from './item';

interface Signature {
  Element: HTMLDivElement;
  Blocks: {
    default: [{ Item: ComponentLike<AccordionItemSignature> }];
  };
}

const Accordion: TemplateOnlyComponent<Signature> = <template>
  <div class='accordion' ...attributes>
    {{yield (hash Item=(component AccordionItem className='item'))}}
  </div>
  <style>
    .accordion {
      --accordion-default-item-height: var(--item-open-min-height, 6rem);
      --accordion-background-color: var(--boxel-light);
      --accordion-border: var(--boxel-border);
      --accordion-border-radius: var(--boxel-border-radius-xl);

      display: flex;
      flex-direction: column;
      background-color: var(--accordion-background-color);
      border: var(--accordion-border);
      border-radius: var(--accordion-border-radius);
    }
    .accordion > :deep(.item + .item) {
      border-top: var(--accordion-border);
    }
  </style>
</template>;

export default Accordion;
