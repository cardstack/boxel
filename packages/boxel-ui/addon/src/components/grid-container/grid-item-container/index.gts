import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { type FittedFormatId } from '../../../helpers.ts';
import FittedCardContainer from '../../fitted-card-container/index.gts';

export interface GridItemContainerSignature {
  Args: { fullWidth?: boolean; size?: FittedFormatId };
  Blocks: {
    after?: [];
    before?: [];
    default: [];
  };
  Element: HTMLElement;
}

const GridItemContainer: TemplateOnlyComponent<GridItemContainerSignature> =
  <template>
    <div class='boxel-grid-item-container' ...attributes>
      {{#if (has-block 'before')}}
        {{yield to='before'}}
      {{/if}}

      <FittedCardContainer @size={{@size}} @fullWidth={{@fullWidth}}>
        {{yield}}
      </FittedCardContainer>

      {{#if (has-block 'after')}}
        {{yield to='after'}}
      {{/if}}
    </div>
  </template>;

export default GridItemContainer;
