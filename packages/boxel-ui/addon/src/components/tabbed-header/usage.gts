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
  @tracked headerTitle = 'AI App Generator';
  @tracked activeTabId = this.tabs[0]?.tabId;
  @tracked headerColor = '#ffd800';

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.activeTabId = window.location?.hash?.slice(1) ?? this.tabs[0]?.tabId;
  }

  setActiveTab = (tabId: string) => (this.activeTabId = tabId);

  <template>
    <FreestyleUsage @name='TabbedHeader'>
      <:example>
        <TabbedHeader
          @headerTitle={{this.headerTitle}}
          @tabs={{this.tabs}}
          @setActiveTab={{this.setActiveTab}}
          @activeTabId={{this.activeTabId}}
          @headerBackgroundColor={{this.headerColor}}
        >
          <:headerIcon>
            <Icon width='25' height='25' role='presentation' />
          </:headerIcon>
        </TabbedHeader>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='headerTitle'
          @description='Title to be displayed on the header'
          @value={{this.headerTitle}}
          @onInput={{fn (mut this.headerTitle)}}
          @required={{true}}
        />
        <Args.Object
          @name='tabs'
          @description='Tabs for navigation'
          @value={{this.tabs}}
          @onInput={{fn (mut this.tabs)}}
        />
        <Args.String
          @name='activeTabId'
          @description='Id of the active tab'
          @value={{this.activeTabId}}
          @onInput={{fn (mut this.activeTabId)}}
        />
        <Args.Action
          @name='setActiveTab'
          @description='Action to be called when a tab is clicked'
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
