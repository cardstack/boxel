import { fn } from '@ember/helper';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import Icon from '../../icons/sparkle.gts';
import BoxelInput from '../input/index.gts';
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
  @tracked searchValue = '';

  @cssVariable({ cssClassName: 'tabbed-header-freestyle-container' })
  declare headerTitleFontWeight: CSSVariableInfo;
  @cssVariable({ cssClassName: 'tabbed-header-freestyle-container' })
  declare headerTitleFontSize: CSSVariableInfo;
  @cssVariable({ cssClassName: 'tabbed-header-freestyle-container' })
  declare headerTitleLsp: CSSVariableInfo;
  @cssVariable({ cssClassName: 'tabbed-header-freestyle-container' })
  declare headerTitleTransform: CSSVariableInfo;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.activeTabId = window.location?.hash?.slice(1) ?? this.tabs[0]?.tabId;
  }

  setActiveTab = (tabId: string) => (this.activeTabId = tabId);

  <template>
    <div
      class='tabbed-header-freestyle-container'
      style={{cssVar
        boxel-header-title-font-weight=this.headerTitleFontWeight.value
        boxel-header-title-font-size=this.headerTitleFontSize.value
        boxel-header-title-lsp=this.headerTitleLsp.value
        boxel-header-title-transform=this.headerTitleTransform.value
      }}
    >
      <FreestyleUsage
        @name='TabbedHeader'
        @description='Header row with horizontally arranged tab buttons that switch between sections — pair with content panels below for the standard tabs pattern. The title row is optional; omit headerTitle to render just the tab bar.'
      >
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
            <:sideContent>
              <BoxelInput
                @type='search'
                @value={{this.searchValue}}
                @onInput={{fn (mut this.searchValue)}}
                placeholder='Search...'
              />
            </:sideContent>
          </TabbedHeader>
        </:example>
        <:api as |Args|>
          <Args.String
            @name='headerTitle'
            @description='Title to be displayed on the header. When omitted, the title row (including the headerIcon block) is not rendered.'
            @value={{this.headerTitle}}
            @onInput={{fn (mut this.headerTitle)}}
          />
          <Args.Object
            @name='tabs'
            @description='Tabs for navigation. Each entry is { displayName, tabId }.'
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
            @description='Action to be called when a tab is clicked; receives the clicked tabId.'
          />
          <Args.String
            @name='headerBackgroundColor'
            @description='3-or-6 digit hex color code for the background color. The foreground/text color is derived automatically for contrast.'
            @value={{this.headerColor}}
            @onInput={{fn (mut this.headerColor)}}
          />
          <Args.Yield
            @name='headerIcon'
            @description='Block rendered before the title; typically an icon. Only shown when headerTitle is present.'
          />
          <Args.Yield
            @name='sideContent'
            @description='Block rendered at the end of the tab row; typically a search input or actions.'
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-header-background'
            @description='Header background color. Set automatically from @headerBackgroundColor; falls back to var(--sidebar, var(--card)).'
          />
          <Css.Basic
            @name='boxel-header-foreground'
            @description='Header text color. Derived for contrast from @headerBackgroundColor; falls back to var(--sidebar-foreground, var(--card-foreground)).'
          />
          <Css.Basic
            @name='boxel-header-title-font-weight'
            @type='font-weight'
            @description='Font weight of the header title (default 900)'
            @defaultValue={{this.headerTitleFontWeight.defaults}}
            @value={{this.headerTitleFontWeight.value}}
            @onInput={{this.headerTitleFontWeight.update}}
          />
          <Css.Basic
            @name='boxel-header-title-font-size'
            @type='length'
            @description='Font size of the header title'
            @defaultValue={{this.headerTitleFontSize.defaults}}
            @value={{this.headerTitleFontSize.value}}
            @onInput={{this.headerTitleFontSize.update}}
          />
          <Css.Basic
            @name='boxel-header-title-lsp'
            @type='length'
            @description='Letter spacing of the header title'
            @defaultValue={{this.headerTitleLsp.defaults}}
            @value={{this.headerTitleLsp.value}}
            @onInput={{this.headerTitleLsp.update}}
          />
          <Css.Basic
            @name='boxel-header-title-transform'
            @type='text-transform'
            @description='Text transform of the header title (e.g. uppercase, none)'
            @defaultValue={{this.headerTitleTransform.defaults}}
            @value={{this.headerTitleTransform.value}}
            @onInput={{this.headerTitleTransform.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
  </template>
}
