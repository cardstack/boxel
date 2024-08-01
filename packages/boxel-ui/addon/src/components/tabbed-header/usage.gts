import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import Icon from '../../icons/sparkle.gts';
import { ALL_ICON_COMPONENTS } from '../../icons.gts';
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
  @tracked iconComponent = Icon;
  @tracked iconURL = '';
  @tracked activeTabIndex = 0;
  @tracked headerColor = '#ffd800';
  @tracked iconBackgroundColor?: string;
  @tracked iconBorderColor?: string;
  @tracked iconCoversAllAvailableSpace = false;

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
          @iconComponent={{this.iconComponent}}
          @iconURL={{this.iconURL}}
          @headerBackgroundColor={{this.headerColor}}
          @iconBackgroundColor={{this.iconBackgroundColor}}
          @iconBorderColor={{this.iconBorderColor}}
          @iconCoversAllAvailableSpace={{this.iconCoversAllAvailableSpace}}
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
        <Args.String
          @name='iconURL'
          @description='Instead of an icon component, use an image URL for the icon'
          @value={{this.iconURL}}
          @onInput={{fn (mut this.iconURL)}}
        />
        <Args.Component
          @name='iconComponent'
          @description='Icon component to be displayed with the title'
          @value={{this.iconComponent}}
          @options={{ALL_ICON_COMPONENTS}}
          @onChange={{fn (mut this.iconComponent)}}
        />
        <Args.String
          @name='iconBackgroundColor'
          @description='Set a background color for the icon'
          @value={{this.iconBackgroundColor}}
          @onInput={{fn (mut this.iconBackgroundColor)}}
          @defaultValue='undefined'
        />
        <Args.String
          @name='iconBorderColor'
          @description='Set a border color for the icon'
          @value={{this.iconBorderColor}}
          @onInput={{fn (mut this.iconBorderColor)}}
          @defaultValue='undefined'
        />
        <Args.Bool
          @name='iconCoversAllAvailableSpace'
          @description='Icon image will cover all available space'
          @defaultValue={{false}}
          @value={{this.iconCoversAllAvailableSpace}}
          @onInput={{fn (mut this.iconCoversAllAvailableSpace)}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
