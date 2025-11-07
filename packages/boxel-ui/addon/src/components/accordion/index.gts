import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { hash } from '@ember/helper';
import type { ComponentLike } from '@glint/template';

import cn from '../../helpers/cn.ts';
import type { AccordionItemSignature } from './item/index.gts';
import AccordionItem from './item/index.gts';

interface Signature {
  Args: {
    displayContainer?: boolean;
  };
  Blocks: {
    default: [{ Item: ComponentLike<AccordionItemSignature> }];
  };
  Element: HTMLDivElement;
}

const Accordion: TemplateOnlyComponent<Signature> = <template>
  <div
    class={{cn 'boxel-accordion' boxel-accordion-container=@displayContainer}}
    ...attributes
  >
    {{yield (hash Item=AccordionItem)}}
  </div>
  <style scoped>
    @layer boxelComponentL1 {
      .boxel-accordion {
        --accordion-border: var(
          --boxel-accordion-border,
          1px solid var(--border, var(--boxel-border-color))
        );

        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .boxel-accordion-container {
        --boxel-accordion-trigger-padding-inline: var(--boxel-sp-xs);

        border: var(--accordion-border);
        border-radius: var(--boxel-border-radius);
      }
    }
  </style>
</template>;

export { AccordionItem };

export default Accordion;
