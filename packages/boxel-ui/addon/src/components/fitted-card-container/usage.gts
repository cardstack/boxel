import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import {
  fittedFormatById,
  fittedFormatIds,
  type FittedFormatId,
} from '../../helpers.ts';
import FittedCardContainer from './index.gts';

export default class FittedCardContainerUsage extends Component {
  sampleSizes = fittedFormatIds;

  formatTitle(size: FittedFormatId) {
    return fittedFormatById.get(size)?.title ?? size;
  }

  formatDimensions(size: FittedFormatId) {
    let spec = fittedFormatById.get(size);
    return spec ? `${spec.width}px × ${spec.height}px` : '';
  }

  <template>
    <FreestyleUsage @name='FittedCardContainer'>
      <:description>
        Constrains card content to a fixed fitted size so layouts stay aligned.
      </:description>
      <:example>
        <div class='fitted-card-container-usage-grid'>
          {{#each this.sampleSizes as |size|}}
            <FittedCardContainer @size={{size}}>
              <div class='fitted-card-container-usage-card'>
                <div class='fitted-card-container-usage-title'>
                  {{this.formatTitle size}}
                </div>
                <div class='fitted-card-container-usage-meta'>
                  {{this.formatDimensions size}}
                </div>
              </div>
            </FittedCardContainer>
          {{/each}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='size'
          @description='Fitted size id from the fitted formats list.'
        />
        <Args.Yield
          @description='Card content rendered inside the sized container.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .fitted-card-container-usage-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: var(--boxel-sp);
        align-items: start;
      }
      .fitted-card-container-usage-card {
        width: 100%;
        height: 100%;
        padding: var(--boxel-sp);
        display: grid;
        gap: var(--boxel-sp-2xs);
        place-content: center;
        text-align: center;
        border: var(--boxel-border-card);
        border-radius: var(--boxel-border-radius);
        background: color-mix(
          in oklab,
          var(--background, var(--boxel-light)) 92%,
          var(--foreground, var(--boxel-dark))
        );
        color: var(--foreground, var(--boxel-dark));
        font: var(--boxel-font-sm);
      }
      .fitted-card-container-usage-title {
        font-weight: 600;
      }
      .fitted-card-container-usage-meta {
        color: var(--muted-foreground, var(--boxel-500));
        font: var(--boxel-font-xs);
      }
    </style>
  </template>
}
