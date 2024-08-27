/* eslint-disable no-console */
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import BoxelBadge, { type BoxelBadgeVariant } from './index.gts';
import { fn } from '@ember/helper';

export default class BadgeUsage extends Component {
  variants = ['default', 'secondary', 'destructive', 'outline'];

  @tracked variant: BoxelBadgeVariant = 'default';

  <template>
    <FreestyleUsage @name='Badge'>
      <:example>
        <div class='usage-center-div'>
          <BoxelBadge @variant={{this.variant}}>
            Badge
          </BoxelBadge>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='kind'
          @optional={{true}}
          @description='Controls the style of the badge'
          @defaultValue={{'default'}}
          @options={{this.variants}}
          @onInput={{fn (mut this.variant)}}
          @value={{this.variant}}
        />
      </:api>
    </FreestyleUsage>
    <style>
      .usage-center-div {
        display: flex;
        flex-wrap: wrap;
        flex-basis: 0;
        flex-grow: 99;
        justify-content: center;
        align-items: center;
        min-height: 100%;
        padding: 2rem;
      }
    </style>
  </template>
}
