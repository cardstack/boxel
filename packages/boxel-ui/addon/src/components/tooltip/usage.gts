import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { MiddlewareState } from '@floating-ui/dom';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import BoxelButton from '../button/index';
import BoxelTooltip from './index';

export default class TooltipUsage extends Component {
  @tracked placement: MiddlewareState['placement'] = 'bottom';
  @tracked offset = 6;

  @action log(message: string): void {
    // eslint-disable-next-line no-console
    console.log(message);
  }

  <template>
    <FreestyleUsage @name='Tooltip'>
      <:example>
        <BoxelTooltip @placement={{this.placement}} @offset={{this.offset}}>
          <:trigger>
            <BoxelButton
              {{on 'click' (fn this.log 'button clicked')}}
              id='button'
            >
              Button With Tooltip
            </BoxelButton>
          </:trigger>
          <:content>
            Tooltip Content
          </:content>
        </BoxelTooltip>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='placement'
          @optional={{true}}
          @description='The positioning of the tooltip relative to the reference element.'
          @value={{this.placement}}
          @options={{array 'top' 'bottom' 'left' 'right'}}
          @onInput={{fn (mut this.placement)}}
          @defaultValue='top'
        />
        <Args.Number
          @name='offset'
          @description="A modifier that adjusts the tooltip's position along specific axes."
          @value={{this.offset}}
          @onInput={{fn (mut this.offset)}}
          @defaultValue='5'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
