import Component from '@glimmer/component';
import { action } from '@ember/object';
import { Link } from 'ember-link';
import { type MenuItem } from '../../helpers/menu-item';
import { type MenuDivider } from '../../helpers/menu-divider';
import { type EmptyObject } from '@ember/component/helper';
import { eq } from '../../helpers/truth-helpers';
import cn from '../../helpers/cn';
import compact from 'ember-composable-helpers/helpers/compact';
import { on } from '@ember/modifier';
import { svgJar } from '../../helpers/svg-jar';
import { fn } from '@ember/helper';

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
  Element: HTMLUListElement;
  Args: {
    class?: string;
    closeMenu?: () => void;
    items: Array<MenuItem | MenuDivider>;
    itemClass?: string;
  };
  Blocks: EmptyObject;
}

export default class Menu extends Component<Signature> {
  @action invokeMenuItemAction(actionOrLink: unknown, e: Event): void {
    e.preventDefault();

    if (actionOrLink instanceof Link && actionOrLink.transitionTo) {
      actionOrLink.transitionTo();
    } else {
      (actionOrLink as () => never)();
    }
    let { closeMenu } = this.args;
    closeMenu && closeMenu();
  }

  <template>
    {{! template-lint-disable no-invalid-role }}
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
                  boxel-menu__item--has-icon=menuItem.icon
                  boxel-menu__item--selected=menuItem.selected
                  boxel-menu__item--disabled=menuItem.disabled
                }}
                data-test-boxel-menu-item
              >
                {{! template-lint-disable require-context-role }}
                <div
                  class='boxel-menu__item__content'
                  role='menuitem'
                  href='#'
                  data-test-boxel-menu-item-text={{menuItem.text}}
                  tabindex={{menuItem.tabindex}}
                  {{on 'click' (fn this.invokeMenuItemAction menuItem.action)}}
                  disabled={{menuItem.disabled}}
                >
                  {{#if menuItem.icon}}
                    {{svgJar
                      menuItem.icon
                      width='16'
                      height='16'
                      data-test-boxel-menu-item-icon=true
                    }}
                  {{/if}}
                  {{menuItem.text}}
                </div>
              </li>
            </:item>
          </MenuItemRenderer>
        {{/each}}
      {{/if}}
    </ul>
    <style>
      .boxel-menu {
        --boxel-menu-color: var(--boxel-light);
        --boxel-menu-current-color: var(--boxel-light-100);
        --boxel-menu-selected-color: var(--boxel-highlight);
        --boxel-menu-disabled-color: var(--boxel-highlight);
        --boxel-menu-font: var(--boxel-font-sm);

        list-style-type: none;
        margin: 0;
        padding: 0;
      }

      .boxel-menu__item {
        background-color: var(--boxel-menu-color);
        font: var(--boxel-menu-font);
        letter-spacing: var(--boxel-lsp-sm);
      }

      .boxel-menu__item:hover {
        background-color: var(--boxel-menu-current-color);
        cursor: pointer;
      }

      .boxel-menu__item:first-child {
        border-radius: var(--boxel-border-radius) var(--boxel-border-radius) 0 0;
      }

      .boxel-menu__item:last-child {
        border-radius: 0 0 var(--boxel-border-radius) var(--boxel-border-radius);
      }

      .boxel-menu__item:only-child {
        border-radius: var(--boxel-border-radius);
      }

      .boxel-menu__item > .boxel-menu__item__content {
        width: max-content;
        padding: var(--boxel-sp-xs) var(--boxel-sp);

        display: flex;
        align-items: center;
        gap: 10px;
      }

      .boxel-menu__item--disabled .boxel-menu__item__content {
        pointer-events: none;
      }

      .boxel-menu__item > .boxel-menu__item__content:hover {
        color: inherit;
      }

      .boxel-menu__item--dangerous {
        color: var(--boxel-danger);
        fill: var(--boxel-danger);
      }

      .boxel-menu__item--selected,
      .boxel-menu__item--selected.boxel-menu__item:hover {
        background-color: var(--boxel-menu-selected-color);
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
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Boxel::Menu': typeof Menu;
  }
}
