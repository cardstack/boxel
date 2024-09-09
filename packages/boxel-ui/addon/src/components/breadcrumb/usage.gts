/* eslint-disable no-console */

import {
  BoxelDropdown,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';
import { cssVar, eq, menuItem } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type RouterService from '@ember/routing/router-service';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import type { BoxelButtonSize } from '../button/index';
import Breadcrumb, {
  type BoxelSeparatorVariant,
  BreadcrumbSeparator,
} from './index.gts';

export default class BreadcrumbUsage extends Component {
  @service declare router: RouterService;

  @tracked breadcrumbItemSize: BoxelButtonSize = 'base';
  @tracked separatorVariant: BoxelSeparatorVariant = 'caretRight';

  sizeOptions: BoxelButtonSize[] = ['extra-small', 'base', 'touch'];
  separatorOptions: BoxelSeparatorVariant[] = ['caretRight', 'slash'];

  get activeRoute(): any {
    //keep route url decoded
    return decodeURIComponent(this.router.currentURL ?? '');
  }

  //i use window.location.href to navigate because the router.transitionTo is not available to link-to external routes
  @action
  goToRoute(routeName: string) {
    //this.router.transitionTo(routeName);
    window.location.href = routeName;
  }

  @cssVariable({ cssClassName: 'breadcrumb-freestyle-container' })
  declare boxelButtonTextColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'breadcrumb-freestyle-container' })
  declare boxelBreadcrumbIconColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'breadcrumb-freestyle-container' })
  declare boxelButtonTextHighlightColor: CSSVariableInfo;

  @tracked iconWidth = '40px';
  @tracked iconHeight = '40px';

  @cssVariable({ cssClassName: 'breadcrumb-freestyle-container' })
  declare boxelBreadcrumbIconWidth: CSSVariableInfo;
  @cssVariable({ cssClassName: 'breadcrumb-freestyle-container' })
  declare boxelBreadcrumbIconHeight: CSSVariableInfo;

  <template>
    <div
      style={{cssVar
        boxel-button-text-color=this.boxelButtonTextColor.value
        boxel-breadcrumb-icon-color=this.boxelBreadcrumbIconColor.value
        boxel-button-text-highlight-color=this.boxelButtonTextHighlightColor.value
        boxel-breadcrumb-icon-width=this.boxelBreadcrumbIconWidth.value
        boxel-breadcrumb-icon-height=this.boxelBreadcrumbIconHeight.value
      }}
    >
      <FreestyleUsage @name='Breadcrumb'>
        <:example>

          <Breadcrumb
            @breadcrumbItemSize={{this.breadcrumbItemSize}}
            @separatorVariant={{this.separatorVariant}}
            as |BreadcrumbItem|
          >
            <BreadcrumbItem
              {{on 'click' (fn this.goToRoute '/')}}
              class={{if (eq this.activeRoute '/') 'is-selected'}}
            >
              All
            </BreadcrumbItem>
            <BreadcrumbSeparator @variant={{this.separatorVariant}} />
            <BreadcrumbItem
              {{on 'click' (fn this.goToRoute '/?s=Components')}}
              class={{if (eq this.activeRoute '/?s=Components') 'is-selected'}}
            >
              Components
            </BreadcrumbItem>
            <BreadcrumbSeparator @variant={{this.separatorVariant}} />
            <BreadcrumbItem
              class={{if
                (eq this.activeRoute '/?s=Components&ss=<Breadcrumb>')
                'is-selected'
              }}
              @disabled={{true}}
            >
              Breadcrumb
            </BreadcrumbItem>
          </Breadcrumb>
        </:example>
        <:api as |Args|>
          <Args.String
            @name='breadcrumbItemSize'
            @description='Size of the breadcrumb items'
            @options={{this.sizeOptions}}
            @value={{this.breadcrumbItemSize}}
            @onInput={{fn (mut this.breadcrumbItemSize)}}
          />
          <Args.String
            @name='separatorVariant'
            @description='Variant of the separator'
            @options={{this.separatorOptions}}
            @value={{this.separatorVariant}}
            @onInput={{fn (mut this.separatorVariant)}}
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-button-text-color'
            @type='color'
            @description='Button color for breadcrumb items'
            @defaultValue={{this.boxelButtonTextColor.defaults}}
            @value={{this.boxelButtonTextColor.value}}
            @onInput={{this.boxelButtonTextColor.update}}
          />
          <Css.Basic
            @name='boxel-breadcrumb-icon-color'
            @type='color'
            @description='Color for breadcrumb separators'
            @defaultValue={{this.boxelBreadcrumbIconColor.defaults}}
            @value={{this.boxelBreadcrumbIconColor.value}}
            @onInput={{this.boxelBreadcrumbIconColor.update}}
          />
          <Css.Basic
            @name='boxel-button-text-highlight-color'
            @type='color'
            @description='Highlight color for selected breadcrumb items'
            @defaultValue={{this.boxelButtonTextHighlightColor.defaults}}
            @value={{this.boxelButtonTextHighlightColor.value}}
            @onInput={{this.boxelButtonTextHighlightColor.update}}
          />
          <Css.Basic
            @name='boxel-breadcrumb-icon-width'
            @type='dimension'
            @description='Used to size the width of the breadcrumb icon'
            @defaultValue={{this.boxelBreadcrumbIconWidth.defaults}}
            @value={{this.boxelBreadcrumbIconWidth.value}}
            @onInput={{this.boxelBreadcrumbIconWidth.update}}
          />
          <Css.Basic
            @name='boxel-breadcrumb-icon-height'
            @type='dimension'
            @description='Used to size the height of the breadcrumb icon'
            @defaultValue={{this.boxelBreadcrumbIconHeight.defaults}}
            @value={{this.boxelBreadcrumbIconHeight.value}}
            @onInput={{this.boxelBreadcrumbIconHeight.update}}
          />
        </:cssVars>
      </FreestyleUsage>

      <FreestyleUsage @name='Breadcrumb with dropdown'>
        <:example>
          <Breadcrumb
            @breadcrumbItemSize={{this.breadcrumbItemSize}}
            @separatorVariant={{this.separatorVariant}}
            as |BreadcrumbItem|
          >
            <BreadcrumbItem {{on 'click' (fn this.goToRoute '/')}}>
              All
            </BreadcrumbItem>
            <BreadcrumbSeparator @variant={{this.separatorVariant}} />
            <BreadcrumbItem>
              <BoxelDropdown>
                <:trigger as |bindings|>
                  <BreadcrumbItem {{bindings}}>
                    ...
                  </BreadcrumbItem>
                </:trigger>
                <:content as |dd|>
                  <BoxelMenu
                    @closeMenu={{dd.close}}
                    @items={{array
                      (menuItem
                        'Youtube' (fn this.goToRoute 'https://www.youtube.com')
                      )
                      (menuItem
                        'Google' (fn this.goToRoute 'https://www.google.com/')
                      )
                    }}
                  />
                </:content>
              </BoxelDropdown>
            </BreadcrumbItem>
            <BreadcrumbSeparator @variant={{this.separatorVariant}} />
            <BreadcrumbItem
              class={{if
                (eq this.activeRoute '/?s=Components&ss=<Breadcrumb>')
                'is-selected'
              }}
              @disabled={{true}}
            >
              Breadcrumb
            </BreadcrumbItem>

          </Breadcrumb>

        </:example>
      </FreestyleUsage>
    </div>
  </template>
}
