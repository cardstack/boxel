import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import type { ComponentLike } from '@glint/template';

import type { AccordionItemSignature } from './item/index.gts';
import AccordionItem from './item/index.gts';

interface Signature {
  Blocks: {
    default: [{ Item: ComponentLike<AccordionItemSignature> }];
  };
  Element: HTMLDivElement;
}

const Accordion: TemplateOnlyComponent<Signature> = <template>
  <div class='accordion' ...attributes>
    {{yield (hash Item=(component AccordionItem className='item'))}}
  </div>
  <style>
    .accordion {
      --accordion-background-color: var(--boxel-light);
      --accordion-border: var(--boxel-border);
      --accordion-border-radius: var(--boxel-border-radius-xl);

      display: flex;
      flex-direction: column;
      height: 100%;
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
