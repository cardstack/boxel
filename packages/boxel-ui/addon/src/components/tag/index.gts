import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import Pill, { type BoxelPillKind } from '../pill/index.gts';

export interface TagSignature {
  Args: {
    borderColor?: string;
    ellipsize?: boolean;
    fontColor?: string;
    kind?: BoxelPillKind;
    name?: string;
    pillColor?: string;
    tag?: keyof HTMLElementTagNameMap;
  };
  Element: HTMLElement;
}

const Tag: TemplateOnlyComponent<TagSignature> = <template>
  <Pill
    class='tag-pill'
    @pillBackgroundColor={{@pillColor}}
    @pillBorderColor={{if @borderColor @borderColor @pillColor}}
    @pillFontColor={{@fontColor}}
    @tag={{@tag}}
    @kind={{@kind}}
    ...attributes
  >
    <span class={{cn 'tag-name' ellipsize=@ellipsize}}>
      {{@name}}
    </span>
  </Pill>

  <style scoped>
    @layer {
      .tag-pill {
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-xxxs);
        --pill-font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
        max-width: 100%;
        word-break: unset;
      }
      .ellipsize {
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
    }
  </style>
</template>;

export default Tag;
