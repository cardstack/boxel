import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import {
  type FittedFormatId,
  fittedFormatById,
  fittedFormatIds,
} from '../../helpers.ts';
import CardContainer from '../card-container/index.gts';
import GridContainer from '../grid-container/index.gts';
import FittedCardContainer from './index.gts';

export default class FittedCardContainerUsage extends Component {
  fittedFormats = fittedFormatIds;
  usageFormatOptions = [undefined, ...this.fittedFormats];

  @tracked fullWidth = false;
  @tracked selectedSize?: FittedFormatId = undefined;

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
        Constrains card to fitted height and optionally responsive width.
      </:description>
      <:example>
        <GridContainer>
          {{#if this.selectedSize}}
            <FittedCardContainer
              @size={{this.selectedSize}}
              @fullWidth={{this.fullWidth}}
            >
              <CardContainer @displayBoundaries={{true}}>
                <h4>{{this.formatTitle this.selectedSize}}</h4>
                {{this.formatDimensions this.selectedSize}}
              </CardContainer>
            </FittedCardContainer>
          {{else}}
            {{#each this.fittedFormats as |size|}}
              <FittedCardContainer @size={{size}} @fullWidth={{this.fullWidth}}>
                <CardContainer @displayBoundaries={{true}}>
                  <h4>{{this.formatTitle size}}</h4>
                  {{this.formatDimensions size}}
                </CardContainer>
              </FittedCardContainer>
            {{/each}}
          {{/if}}
        </GridContainer>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='size'
          @description='Fitted size id from the fitted formats list.'
          @options={{this.usageFormatOptions}}
          @value={{this.selectedSize}}
          @onInput={{fn (mut this.selectedSize)}}
        />
        <Args.Bool
          @name='fullWidth'
          @description='Whether item should have 100% width (height is restricted).'
          @value={{this.fullWidth}}
          @onInput={{fn (mut this.fullWidth)}}
          @defaultValue={{false}}
        />
        <Args.Yield
          @description='Card content rendered inside the sized container.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
