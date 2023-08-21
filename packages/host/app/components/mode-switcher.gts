import Component from '@glimmer/component';
import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { menuItemFunc, MenuItem } from '@cardstack/boxel-ui/helpers/menu-item';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import map from 'ember-composable-helpers/helpers/map';
import { service } from '@ember/service';
import RouterService from '@ember/routing/router-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type CardService from '../services/card-service';
import { on } from '@ember/modifier';

interface Signature {
  Element: HTMLElement;
}

type Mode = {
  icon: string,
  label: string,
}

export default class ModeSwitcher extends Component<Signature> {
  <template>
    <div
      class='mode-switcher' 
      ...attributes>
      <BoxelDropdown>
        <:trigger as |bindings|>
          <Button
            class='trigger'
            aria-label='Options'
            data-test-embedded-card-options-button
            {{on 'click' this.toogleDropdown}}
            {{bindings}}
          >
            {{svgJar this.selectedMode.icon width='18px' height='18px'}}
            {{this.selectedMode.label}}
            {{#if this.isExpanded}}
              <div class='arrow-icon'>{{svgJar 'dropdown-arrow-up' width='22px' height='22px'}}</div>
            {{else}}
              <div class='arrow-icon'>{{svgJar 'dropdown-arrow-down' width='22px' height='22px'}}</div>
            {{/if}}
          </Button>
        </:trigger>
        <:content as |dd|>
          <Menu
            class='content'
            @closeMenu={{dd.close}}
            @items={{map (fn this.buildMenuItem this.select) this.modes}}
          />
        </:content>
      </BoxelDropdown>
    </div>
    <style>
      .trigger {
        border: none;
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-purple-700);
        color: var(--boxel-light);
        font: 500 var(--boxel-font-sm);

        position: relative;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        width: 190px;
        gap: var(--boxel-sp-sm);

        --icon-color: var(--boxel-cyan);
      }
      .arrow-icon {
        margin-left: auto;
        
        display: flex;
      }
      .content {
        border-radius: var(--boxel-border-radius);
        width: 190px;
        background: rgba(0, 0, 0, 0.45);
        color: var(--boxel-light);
        font: 500 var(--boxel-font-sm);

        --icon-color: var(--boxel-light);
      }
      :global(.ember-basic-dropdown-content) {
        background: none;
      }
      :global(.content .boxel-menu__item) {
        background: none;
      }
      :global(.content .boxel-menu__item:hover) {
        background: rgba(0, 0, 0, 0.3);
      }
      :global(.content .boxel-menu__item > .boxel-menu__item__content) {
        padding: var(--boxel-sp-xs);
      }
      :global(.content .menu-item) {
        gap: var(--boxel-sp-sm);
      }
    </style>
  </template>

  modes: Mode[] = [
    {
      icon: 'eye',
      label: 'Interact',
    },
    {
      icon: 'icon-code',
      label: 'Code',
    }
  ]
  @tracked selectedMode: Mode = this.modes[0];
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare cardService: CardService;
  @service private declare router: RouterService;
  @tracked isExpanded  = false;

  @action
  toogleDropdown() {
    this.isExpanded = !this.isExpanded;
  }
  
  @action 
  buildMenuItem(onChoose: (mode: Mode) => void, mode: Mode): MenuItem {
    return menuItemFunc([mode.label, () => onChoose(mode)], {icon: mode.icon});
  }

  @action
  select(mode: Mode) {
    if (this.selectedMode.label === mode.label) return;
    this.selectedMode = mode;
  }
}
