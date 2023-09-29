import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import IconGlobe from '../../../icons/icon-globe.gts';
import { ALL_ICON_COMPONENTS } from '../../../icons/index.gts';
import type { Icon } from '../../../icons/types.ts';
import BoxelDropdownTrigger from './index.gts';

export default class BoxelDropdownUsage extends Component {
  @tracked icon: Icon | undefined = IconGlobe;
  @tracked label: string | undefined = 'Choose one';
  @tracked isMissingValue: boolean | undefined;
  <template>
    <FreestyleUsage @name='DropdownTrigger'>
      <:description>
        This component is a building block for rendering a dropdown trigger with
        a label and optional icon. It is a button with no border and a downward
        facing caret. Use splattributes to add click handlers, CSS classes,
        modifiers, etc.
      </:description>
      <:example>
        <BoxelDropdownTrigger
          @icon={{this.icon}}
          @label={{this.label}}
          @isMissingValue={{this.isMissingValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.Component
          @name='icon'
          @description='Optional icon component reference to show on the left of the trigger'
          @value={{this.icon}}
          @options={{ALL_ICON_COMPONENTS}}
          @onChange={{fn (mut this.icon)}}
        />
        <Args.String
          @name='label'
          @description='The text to display'
          @value={{this.label}}
          @onInput={{fn (mut this.label)}}
        />
        <Args.Bool
          @name='isMissingValue'
          @description='Whether the value is present. If true, the label will be shown in a lighter placeholder-esque shade.'
          @defaultValue={{false}}
          @value={{this.isMissingValue}}
          @onInput={{fn (mut this.isMissingValue)}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
