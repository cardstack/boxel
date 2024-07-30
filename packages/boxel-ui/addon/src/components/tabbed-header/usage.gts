import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import Icon from '../../icons/sparkle.gts';
import TabbedHeader from './index.gts';

export default class TabbedHeaderUsage extends Component {
  @tracked tabs = [
    {
      label: 'Dashboard',
      value: 'dashboard',
    },
    {
      label: 'Requirements',
      value: 'requirements',
    },
    {
      label: 'Your Apps',
      value: 'your-apps',
    },
    {
      label: 'Sample Apps',
      value: 'sample-apps',
    },
    {
      label: 'Favorites',
      value: 'favorites',
    },
  ];
  @tracked title = 'AI App Generator';
  @tracked icon = Icon;
  @tracked headerColor = '#ffd800';

  <template>
    <FreestyleUsage @name='TabbedHeader'>
      <:example>
        <TabbedHeader
          @title={{this.title}}
          @icon={{this.icon}}
          @tabs={{this.tabs}}
          @headerBackgroundColor={{this.headerColor}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @description='Title to be displayed on the header'
          @value={{this.title}}
          @onInput={{fn (mut this.title)}}
          @required={{true}}
        />
        <Args.Component
          @name='icon'
          @description='Icon to be displayed with the title'
        />
        <Args.String
          @name='headerBackgroundColor'
          @description='3-or-6 digit hex color code for background color'
          @value={{this.headerColor}}
          @onInput={{fn (mut this.headerColor)}}
          @defaultValue='#ffffff'
        />
        <Args.Object
          @name='tabs'
          @description='Tabs for navigation'
          @value={{this.tabs}}
          @onInput={{fn (mut this.tabs)}}
        />
        <Args.Action
          @name='onSetActiveTab'
          @description='Optional action to be called when a tab is clicked'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
