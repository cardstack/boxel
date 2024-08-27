import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import Icon from '../../icons/sparkle.gts';
import TabbedHeader, { type BoxelTabVariant } from './index.gts';
import { eq } from '@cardstack/boxel-ui/helpers';

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

  //example: Tab List with pill style
  @tracked tabs1 = [
    {
      displayName: 'Home',
      tabId: 'home',
    },
    {
      displayName: 'About Us',
      tabId: 'about-us',
    },
    {
      displayName: 'Settings',
      tabId: 'settings',
    },
  ];
  @tracked variants1: Array<BoxelTabVariant> = ['default', 'pills'];
  variant1: BoxelTabVariant = 'pills';

  @tracked title1 = '';
  @tracked activeTabIndex1 = 0;
  @tracked headerColor1 = '#ffffff';

  //example: Tab List with Content
  @tracked tabs2 = [
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
  @tracked title2 = 'AI App Generator';
  @tracked activeTabIndex2 = 0;
  @tracked headerColor2 = '#ffffff';

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

  onSetActiveTab1 = (index: number) => {
    this.activeTabIndex1 = index;
  };

  onSetActiveTab2 = (index: number) => {
    this.activeTabIndex2 = index;
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

    <FreestyleUsage @name='Pills'>
      <:example>
        <TabbedHeader
          @variant={{this.variant1}}
          @title={{this.title1}}
          @tabs={{this.tabs1}}
          @onSetActiveTab={{fn this.onSetActiveTab1}}
          @activeTabIndex={{this.activeTabIndex1}}
          @headerBackgroundColor={{this.headerColor1}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='variant'
          @optional={{true}}
          @description='Controls the colors of the button'
          @defaultValue={{'pills'}}
          @options={{this.variants1}}
          @onInput={{fn (mut this.variant1)}}
          @value={{this.variant1}}
        />
      </:api>
    </FreestyleUsage>

    <FreestyleUsage @name='Examples'>
      <:example>
        <TabbedHeader
          @title={{''}}
          @tabs={{this.tabs}}
          @onSetActiveTab={{fn this.onSetActiveTab}}
          @activeTabIndex={{this.activeTabIndex}}
          @headerBackgroundColor={{'white'}}
        />

        {{#if (eq this.activeTabIndex 0)}}
          <div class='tab-content' data-tabId={{this.activeTabIndex}}>
            This is some placeholder content the Dashboard tab's associated
            content. Clicking another tab will toggle the visibility of this one
            for the next. The tab JavaScript swaps classes to control the
            content visibility and styling. You can use it with tabs, pills, and
            any other .nav-powered navigation.
          </div>
        {{/if}}

        {{#if (eq this.activeTabIndex 1)}}
          <div class='tab-content' data-tabId={{this.activeTabIndex}}>
            This is some placeholder content the
            <strong>Requirements tab's</strong>
            associated content. Clicking another tab will toggle the visibility
            of this one for the next. The tab JavaScript swaps classes to
            control the content visibility and styling. You can use it with
            tabs, pills, and any other .nav-powered navigation.
          </div>
        {{/if}}

        {{#if (eq this.activeTabIndex 2)}}
          <div class='tab-content' data-tabId={{this.activeTabIndex}}>
            This is some placeholder content the
            <strong>Your Apps</strong>
            tab's associated content. Clicking another tab will toggle the
            visibility of this one for the next. The tab JavaScript swaps
            classes to control the content visibility and styling. You can use
            it with tabs, pills, and any other .nav-powered navigation.
          </div>
        {{/if}}

        {{#if (eq this.activeTabIndex 3)}}
          <div class='tab-content' data-tabId={{this.activeTabIndex}}>
            This is some placeholder content the
            <strong>Sample Apps</strong>
            tab's associated content. Clicking another tab will toggle the
            visibility of this one for the next. The tab JavaScript swaps
            classes to control the content visibility and styling. You can use
            it with tabs, pills, and any other .nav-powered navigation.
          </div>
        {{/if}}

        {{#if (eq this.activeTabIndex 4)}}
          <div class='tab-content' data-tabId={{this.activeTabIndex}}>
            This is some placeholder content the
            <strong>Favorites</strong>
            tab's associated content. Clicking another tab will toggle the
            visibility of this one for the next. The tab JavaScript swaps
            classes to control the content visibility and styling. You can use
            it with tabs, pills, and any other .nav-powered navigation.
          </div>
        {{/if}}

      </:example>
    </FreestyleUsage>

    <style>
      .tab-content {
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xl) var(--boxel-sp);
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}
