import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import cssUrl from 'ember-css-url';

import cn from '../../helpers/cn.ts';
import compact from '../../helpers/compact.ts';
import type { MenuDivider } from '../../helpers/menu-divider.ts';
import type { MenuAction, MenuItem } from '../../helpers/menu-item.ts';
import CheckMark from '../../icons/check-mark.gts';
import LoadingIndicator from '../loading-indicator/index.gts';

// This little component helps to make glint understand when we have a MenuItem and when we have a MenuDivider
class MenuItemRenderer extends Component<{
  Args: { menuItem: MenuItem | MenuDivider };
  Blocks: {
    divider: [];
    item: [MenuItem];
  };
}> {
  get asMenuItem(): MenuItem {
    return this.args.menuItem as MenuItem;
  }
  <template>
    {{#if @menuItem.isDivider}}
      {{yield to='divider'}}
    {{else}}
      {{yield this.asMenuItem to='item'}}
    {{/if}}
  </template>
}

interface Signature {
  Args: {
    class?: string;
    closeMenu?: () => void;
    itemClass?: string;
    items: Array<MenuItem | MenuDivider>;
    loading?: boolean;
  };
  Element: HTMLUListElement;
}

export default class Menu extends Component<Signature> {
  @action invokeMenuItemAction(
    action: MenuAction,
    e: Event | KeyboardEvent,
  ): void {
    e.preventDefault();

    if (e.type === 'keypress' && (e as KeyboardEvent).key !== 'Enter') {
      return;
    }
    action();
    this.args.closeMenu?.();
  }

  <template>
    <ul role='menu' class={{cn 'boxel-menu' @class}} ...attributes>
      {{#if @loading}}
        <li role='none' class='boxel-menu__item' data-test-boxel-menu-loading>
          <div class='boxel-menu__item__content'>
            <span class='menu-item'>
              <LoadingIndicator />
              Loading...
            </span>
          </div>
        </li>
      {{else if @items}}
        {{#each (compact @items) as |menuItem|}}
          <MenuItemRenderer @menuItem={{menuItem}}>
            <:divider>
              <hr
                class='boxel-menu__separator'
                data-test-boxel-menu-separator
              />
            </:divider>
            <:item as |menuItem|>
              <li
                role='none'
                class={{cn
                  'boxel-menu__item'
                  @itemClass
                  boxel-menu__item--dangerous=menuItem.dangerous
                  boxel-menu__item--has-icon=(if menuItem.icon true false)
                  boxel-menu__item--checked=menuItem.checked
                  boxel-menu__item--disabled=menuItem.disabled
                }}
                data-test-boxel-menu-item
                data-test-boxel-menu-item-selected={{menuItem.checked}}
              >
                {{! template-lint-disable require-context-role }}
                <div
                  class='boxel-menu__item__content'
                  role='menuitem'
                  href='#'
                  data-test-boxel-menu-item-text={{menuItem.label}}
                  tabindex='0'
                  {{on 'click' (fn this.invokeMenuItemAction menuItem.action)}}
                  {{on
                    'keypress'
                    (fn this.invokeMenuItemAction menuItem.action)
                  }}
                  disabled={{menuItem.disabled}}
                >
                  <span class='menu-item'>
                    {{#if menuItem.icon}}
                      <menuItem.icon width='16' height='16' />
                    {{else if menuItem.iconURL}}
                      <span
                        class='menu-item__icon-url'
                        style={{cssUrl 'background-image' menuItem.iconURL}}
                      />
                    {{/if}}
                    {{menuItem.label}}
                    {{#if menuItem.subtext}}
                      <span class='subtext'>
                        {{menuItem.subtext}}
                      </span>
                    {{else if menuItem.subtextComponent}}
                      <span class='subtext'>
                        <menuItem.subtextComponent />
                      </span>
                    {{/if}}
                  </span>
                  {{#if menuItem.postscript}}
                    <span class='postscript'>{{menuItem.postscript}}</span>
                  {{/if}}
                  <span
                    class={{cn
                      'check-icon'
                      check-icon--selected=menuItem.checked
                    }}
                  >
                    <CheckMark class='checkmark' width='12' height='12' />
                  </span>
                </div>
              </li>
            </:item>
          </MenuItemRenderer>
        {{/each}}
      {{/if}}
    </ul>
    <style scoped>
      @layer {
        .boxel-menu {
          --boxel-menu-border-radius: var(--boxel-border-radius);
          --boxel-menu-color: var(--boxel-light);
          --boxel-menu-text-color: var(--boxel-dark);
          --boxel-menu-current-color: var(--boxel-light-100);
          --boxel-menu-selected-color: var(--boxel-highlight);
          --boxel-menu-disabled-color: var(--boxel-highlight);
          --boxel-menu-font: 500 var(--boxel-font-sm);
          --boxel-menu-item-gap: var(--boxel-sp-xxs);
          --boxel-menu-item-content-padding: var(--boxel-sp-xs) var(--boxel-sp);
          list-style-type: none;
          margin: 0;
          padding: 0;
          color: var(--boxel-menu-text-color, inherit);
          background-color: var(--boxel-menu-color);
          border-radius: var(--boxel-menu-border-radius);
        }

        .boxel-menu__item {
          font: var(--boxel-menu-font);
          font-family: inherit;
          letter-spacing: var(--boxel-lsp-sm);
        }

        .boxel-menu__item--checked {
          background-color: var(--boxel-menu-selected-background-color);
          color: var(--boxel-menu-selected-font-color);
        }

        .boxel-menu__item--checked:not(.boxel-menu__item--disabled):hover {
          color: var(--boxel-menu-selected-hover-font-color);
        }

        .boxel-menu__item:not(.boxel-menu__item--disabled):hover {
          background-color: var(--boxel-menu-current-color);
          cursor: pointer;
        }

        .boxel-menu__item:first-child:hover {
          border-top-left-radius: inherit;
          border-top-right-radius: inherit;
        }

        .boxel-menu__item:last-child:hover {
          border-bottom-left-radius: inherit;
          border-bottom-right-radius: inherit;
        }

        .boxel-menu__item:only-child:hover {
          border-radius: inherit;
        }

        .boxel-menu__item > .boxel-menu__item__content {
          width: 100%;
          padding: var(--boxel-menu-item-content-padding);

          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }

        .boxel-menu__item--disabled .boxel-menu__item__content {
          pointer-events: none;
        }

        .boxel-menu__item > .boxel-menu__item__content:hover {
          color: inherit;
        }

        .boxel-menu__item__content:focus-visible {
          outline: var(--boxel-outline);
        }

        .boxel-menu__item--dangerous {
          --icon-color: currentColor;
          color: var(--destructive, var(--boxel-danger));
          fill: currentColor;
        }
        .boxel-menu__item--dangerous:not(:disabled):hover {
          background-color: color-mix(in oklab, currentColor 10%, transparent);
          color: var(--destructive, var(--boxel-danger-hover));
        }

        .boxel-menu__item--disabled,
        .boxel-menu__item--disabled.boxel-menu__item:hover {
          background-color: initial;
          opacity: 0.4;
        }

        .boxel-menu__separator {
          margin: 0;
          border: 0;
          height: 0;
          border-bottom: 1px solid var(--boxel-purple-300);
        }

        .menu-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: var(--boxel-menu-item-gap);
          text-transform: capitalize;
        }
        .menu-item__icon-url {
          flex-shrink: 0;
          display: inline-block;
          width: 16px;
          height: 16px;
          background-position: center;
          background-repeat: no-repeat;
          background-size: contain;
        }

        .check-icon {
          --icon-color: var(--boxel-highlight);
          visibility: collapse;
          display: contents;
        }
        .check-icon--selected {
          visibility: visible;
        }
        .checkmark {
          flex-shrink: 0;
        }
      }
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Boxel::Menu': typeof Menu;
  }
}
