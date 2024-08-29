import { BoxelInput } from '@cardstack/boxel-ui/components';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import { cssVar, eq } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { array } from '@ember/helper';
import { hash } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import Tabs, { type FlexStyleOptions } from './index.gts';

export default class TabsUsage extends Component {
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
  @tracked activeTabIndex = 0;

  @tracked currentFlexStyle: FlexStyleOptions = 'default';

  @cssVariable({ cssClassName: 'tabs-freestyle-container' })
  declare boxelTabsFontSize: CSSVariableInfo;
  @cssVariable({ cssClassName: 'tabs-freestyle-container' })
  declare boxelTabsFontWeight: CSSVariableInfo;
  @cssVariable({ cssClassName: 'tabs-freestyle-container' })
  declare boxelTabsLetterSpacing: CSSVariableInfo;
  @cssVariable({ cssClassName: 'tabs-freestyle-container' })
  declare boxelTabsActiveColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'tabs-freestyle-container' })
  declare boxelTabsActiveBg: CSSVariableInfo;
  @cssVariable({ cssClassName: 'tabs-freestyle-container' })
  declare boxelTabsActiveBorderColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'tabs-freestyle-container' })
  declare boxelTabsGap: CSSVariableInfo;
  @cssVariable({ cssClassName: 'tabs-freestyle-container' })
  declare boxelTabsColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'tabs-freestyle-container' })
  declare boxelTabsBg: CSSVariableInfo;

  @action
  setActiveTab(index: number) {
    this.activeTabIndex = index;
  }

  <template>
    <FreestyleUsage @name='Tabs'>
      <:example>
        <div
          class='tabs-freestyle-container'
          style={{cssVar
            boxel-tabs-font-size=this.boxelTabsFontSize.value
            boxel-tabs-font-weight=this.boxelTabsFontWeight.value
            boxel-tabs-letter-spacing=this.boxelTabsLetterSpacing.value
            boxel-tabs-active-color=this.boxelTabsActiveColor.value
            boxel-tabs-active-bg=this.boxelTabsActiveBg.value
            boxel-tabs-active-border-color=this.boxelTabsActiveBorderColor.value
            boxel-tabs-gap=this.boxelTabsGap.value
            boxel-tabs-color=this.boxelTabsColor.value
            boxel-tabs-bg=this.boxelTabsBg.value
          }}
        >
          <Tabs
            @tabs={{this.tabs}}
            @onSetActiveTab={{fn this.setActiveTab}}
            @activeTabIndex={{this.activeTabIndex}}
            @flexStyle={{this.currentFlexStyle}}
          />
        </div>
      </:example>
      <:api as |Args|>
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
          @name='flexStyle'
          @optional={{true}}
          @description='Flex style of the tabs'
          @defaultValue='default'
          @options={{array 'default' 'fill'}}
          @value={{this.currentFlexStyle}}
          @onInput={{fn (mut this.currentFlexStyle)}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-tabs-text-font-size'
          @type='font-size'
          @description='Tab font size'
          @defaultValue={{this.boxelTabsFontSize.defaults}}
          @value={{this.boxelTabsFontSize.value}}
          @onInput={{this.boxelTabsFontSize.update}}
        />
        <Css.Basic
          @name='boxel-tabs-text-font-weight'
          @type='font-weight'
          @description='Tab font weight'
          @defaultValue={{this.boxelTabsFontWeight.defaults}}
          @value={{this.boxelTabsFontWeight.value}}
          @onInput={{this.boxelTabsFontWeight.update}}
        />
        <Css.Basic
          @name='boxel-tabs-letter-spacing'
          @type='letter-spacing'
          @description='Tab letter spacing'
          @defaultValue={{this.boxelTabsLetterSpacing.defaults}}
          @value={{this.boxelTabsLetterSpacing.value}}
          @onInput={{this.boxelTabsLetterSpacing.update}}
        />
        <Css.Basic
          @name='boxel-tabs-color'
          @type='color'
          @description='Tab text color'
          @defaultValue={{this.boxelTabsColor.defaults}}
          @value={{this.boxelTabsColor.value}}
          @onInput={{this.boxelTabsColor.update}}
        />
        <Css.Basic
          @name='boxel-tabs-bg'
          @type='color'
          @description='Tab background color'
          @defaultValue={{this.boxelTabsBg.defaults}}
          @value={{this.boxelTabsBg.value}}
          @onInput={{this.boxelTabsBg.update}}
        />
        <Css.Basic
          @name='boxel-tabs-active-color'
          @type='color'
          @description='Active tab text color'
          @defaultValue={{this.boxelTabsActiveColor.defaults}}
          @value={{this.boxelTabsActiveColor.value}}
          @onInput={{this.boxelTabsActiveColor.update}}
        />
        <Css.Basic
          @name='boxel-tabs-active-bg'
          @type='color'
          @description='Active tab background color'
          @defaultValue={{this.boxelTabsActiveBg.defaults}}
          @value={{this.boxelTabsActiveBg.value}}
          @onInput={{this.boxelTabsActiveBg.update}}
        />
        <Css.Basic
          @name='boxel-tabs-active-border-color'
          @type='color'
          @description='Active tab border color'
          @defaultValue={{this.boxelTabsActiveBorderColor.defaults}}
          @value={{this.boxelTabsActiveBorderColor.value}}
          @onInput={{this.boxelTabsActiveBorderColor.update}}
        />
        <Css.Basic
          @name='boxel-tabs-gap'
          @type='length'
          @description='Gap between tabs'
          @defaultValue={{this.boxelTabsGap.defaults}}
          @value={{this.boxelTabsGap.value}}
          @onInput={{this.boxelTabsGap.update}}
        />
      </:cssVars>
    </FreestyleUsage>

    <FreestyleUsage @name='Example'>
      <:example>
        <div
          style='display: flex; justify-content: center; padding: var(--boxel-sp-lg); '
        >
          <div
            style='width: 500px; border: 1px solid var(--boxel-200); border-radius: 10px; background-color: var(--boxel-light); overflow: hidden; box-shadow: var(--boxel-box-shadow);'
          >
            <div
              style={{cssVar
                boxel-tabs-font-size='16px'
                boxel-tabs-font-weight='90'
                boxel-tabs-letter-spacing='2px'
                boxel-tabs-active-color='#000'
                boxel-tabs-active-border-color='#000'
                boxel-tabs-gap='5px'
                boxel-tabs-bg='#eee'
                boxel-tabs-active-bg='white'
              }}
            >
              <Tabs
                @tabs={{array
                  (hash displayName='Account' tabId='account')
                  (hash displayName='Password' tabId='password')
                }}
                @onSetActiveTab={{fn this.setActiveTab}}
                @activeTabIndex={{this.activeTabIndex}}
                @flexStyle='fill'
              />

            </div>
            {{#if (eq this.activeTabIndex 0)}}
              <div style='padding: var(--boxel-sp-lg);'>
                <h3 style='margin-bottom: var(--boxel-sp-sm);'>Account Settings</h3>
                <p>Make changes to your account here. Click save when you're
                  done.</p>

                <label style='margin-top: 1rem; display: block;'>Name</label>
                <BoxelInput @value={{''}} style='margin-top: 1rem;' />

                <label
                  style='margin-top: 1rem; display: block;'
                >Username</label>
                <BoxelInput @value={{''}} style='margin-top: 1rem; ' />

                <BoxelButton
                  @kind='primary-dark'
                  style='margin-top: 1.3rem;'
                >Save Changes</BoxelButton>
              </div>
            {{else}}
              <div style='padding: var(--boxel-sp-lg);'>
                <h3 style='margin-bottom: var(--boxel-sp-sm);'>Password Settings</h3>
                <p>Change your password here. After saving, you'll be logged
                  out.</p>

                <label style='margin-top: 1rem; display: block;'>Current
                  password</label>
                <BoxelInput @value={{''}} style='margin-top: 1rem;' />

                <label style='margin-top: 1rem; display: block;'>New password</label>
                <BoxelInput @value={{''}} style='margin-top: 1rem; ' />

                <BoxelButton
                  @kind='primary-dark'
                  style='margin-top: 1.3rem;'
                >Save password</BoxelButton>
              </div>
            {{/if}}
          </div>
        </div>
      </:example>

    </FreestyleUsage>
  </template>
}
