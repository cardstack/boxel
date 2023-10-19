import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import compact from 'ember-composable-helpers/helpers/compact';
import cssUrl from 'ember-css-url';
import { Link } from 'ember-link';

import cn from '../../helpers/cn.ts';
import type { MenuDivider } from '../../helpers/menu-divider.ts';
import type { MenuItem } from '../../helpers/menu-item.ts';
import { eq } from '../../helpers/truth-helpers.ts';
import CheckMark from '../../icons/check-mark.gts';

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
    {{#if (eq @menuItem.type 'divider')}}
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
  };
  Element: HTMLUListElement;
}

export default class Menu extends Component<Signature> {
  @action invokeMenuItemAction(
    actionOrLink: unknown,
    e: Event | KeyboardEvent,
  ): void {
    e.preventDefault();

    if (e.type === 'keypress' && (e as KeyboardEvent).key !== 'Enter') {
      return;
    }

    if (actionOrLink instanceof Link && actionOrLink.transitionTo) {
      actionOrLink.transitionTo();
    } else {
      (actionOrLink as () => never)();
    }
    let { closeMenu } = this.args;
    closeMenu && closeMenu();
  }

  <template>
    <ul role='menu' class={{cn 'boxel-menu' @class}} ...attributes>
      {{#if @items}}
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
                  boxel-menu__item--selected=menuItem.selected
                  boxel-menu__item--disabled=menuItem.disabled
                }}
                data-test-boxel-menu-item
                data-test-boxel-menu-item-selected={{menuItem.selected}}
              >
                {{! template-lint-disable require-context-role }}
                <div
                  class='boxel-menu__item__content'
                  role='menuitem'
                  href='#'
                  data-test-boxel-menu-item-text={{menuItem.text}}
                  tabindex={{menuItem.tabindex}}
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
                    {{menuItem.text}}
                  </span>
                  <span
                    class={{cn
                      'check-icon'
                      check-icon--selected=menuItem.selected
                    }}
                  >
                    <CheckMark width='20' height='20' />
                  </span>
                </div>
              </li>
            </:item>
          </MenuItemRenderer>
        {{/each}}
      {{/if}}
    </ul>
    <style>
      @layer {
        .boxel-menu {
          --boxel-menu-border-radius: var(--boxel-border-radius);
          --boxel-menu-color: var(--boxel-light);
          --boxel-menu-current-color: var(--boxel-light-100);
          --boxel-menu-selected-color: var(--boxel-highlight);
          --boxel-menu-disabled-color: var(--boxel-highlight);
          --boxel-menu-font: 500 var(--boxel-font-sm);
          --boxel-menu-item-gap: var(--boxel-sp-xxs);
          --boxel-menu-item-content-padding: var(--boxel-sp-xs) var(--boxel-sp);
          list-style-type: none;
          margin: 0;
          padding: 0;
          background-color: var(--boxel-menu-color);
          border-radius: var(--boxel-menu-border-radius);
        }

        .boxel-menu__item {
          font: var(--boxel-menu-font);
          letter-spacing: var(--boxel-lsp-sm);
        }

        .boxel-menu__item--selected {
          background-color: var(--boxel-menu-selected-background-color);
          color: var(--boxel-menu-selected-font-color);
        }

        .boxel-menu__item--selected:not(.boxel-menu__item--disabled):hover {
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
          color: var(--boxel-danger);
          fill: var(--boxel-danger);
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
          display: flex;
          align-items: center;
          gap: var(--boxel-menu-item-gap);
        }
        .menu-item__icon-url {
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
      }
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Boxel::Menu': typeof Menu;
  }
}
