import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import Icon from '../../icons/sparkle.gts';
import TabbedHeader from './index.gts';

export default class TabbedHeaderUsage extends Component {
  @tracked tabs = [
    {
      displayName: 'Dashboard',
      tabId: 'dashboard',
    },
    {
      displayName: 'Requirements',
      tabId: 'requirements',
    },
    {
      displayName: 'Your Apps',
      tabId: 'your-apps',
    },
    {
      displayName: 'Sample Apps',
      tabId: 'sample-apps',
    },
    {
      displayName: 'Favorites',
      tabId: 'favorites',
    },
  ];
  @tracked title = 'AI App Generator';
  @tracked activeTabIndex = 0;
  @tracked headerColor = '#ffd800';

  constructor(owner: unknown, args: any) {
    super(owner, args);
    let index = this.tabs?.findIndex(
      (tab) => tab.tabId === window.location?.hash?.slice(1),
    );
    if (index && index !== -1) {
      this.activeTabIndex = index;
    }
  }

  onSetActiveTab = (index: number) => {
    this.activeTabIndex = index;
  };

  <template>
    <FreestyleUsage @name='TabbedHeader'>
      <:example>
        <TabbedHeader
          @title={{this.title}}
          @tabs={{this.tabs}}
          @onSetActiveTab={{fn this.onSetActiveTab}}
          @activeTabIndex={{this.activeTabIndex}}
          @headerBackgroundColor={{this.headerColor}}
        >
          <:headerIcon>
            <Icon width='25' height='25' role='presentation' />
          </:headerIcon>
        </TabbedHeader>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @description='Title to be displayed on the header'
          @value={{this.title}}
          @onInput={{fn (mut this.title)}}
          @required={{true}}
        />
        <Args.Object
          @name='tabs'
          @description='Tabs for navigation'
          @value={{this.tabs}}
          @onInput={{fn (mut this.tabs)}}
        />
        <Args.Number
          @name='activeTabIndex'
          @description='Index of the active tab'
          @defaultValue={{0}}
          @value={{this.activeTabIndex}}
          @onInput={{fn (mut this.activeTabIndex)}}
        />
        <Args.Action
          @name='onSetActiveTab'
          @description='Optional action to be called when a tab is clicked'
        />
        <Args.String
          @name='headerBackgroundColor'
          @description='3-or-6 digit hex color code for background color'
          @value={{this.headerColor}}
          @onInput={{fn (mut this.headerColor)}}
          @defaultValue='#ffffff'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
