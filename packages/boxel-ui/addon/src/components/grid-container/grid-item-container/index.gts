import Component from '@glimmer/component';

import FittedCardContainer from '../../fitted-card-container/index.gts';
import { type FittedFormatId } from '../../../helpers.ts';

export interface GridItemContainerSignature {
  Args: { size?: FittedFormatId; fullWidth?: boolean };
  Blocks: {
    default: [];
    before?: [];
    after?: [];
  };
  Element: HTMLElement;
}

export default class GridItemContainer extends Component<GridItemContainerSignature> {
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
  </template>
}
