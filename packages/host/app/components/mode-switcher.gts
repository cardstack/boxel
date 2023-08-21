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
import { restartableTask } from 'ember-concurrency';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type CardService from '../services/card-service';

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
            {{bindings}}
          >
            {{svgJar this.selectedMode.icon width='18px' height='18px'}}
            {{this.selectedMode.label}}
            <div class='last-icon'>{{svgJar 'check-mark' width='22px' height='22px'}}</div>
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
      .last-icon {
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
  
  @action 
  buildMenuItem(onChoose: (mode: Mode) => void, mode: Mode): MenuItem {
    return menuItemFunc([mode.label, () => onChoose(mode)], {icon: mode.icon});
  }

  @action
  select(mode: Mode) {
    if (this.selectedMode.label === mode.label) return;
    this.selectedMode = mode;

    switch (this.selectedMode.label) {
      case 'Code':
        this.openCodeMode.perform();
        break;
      case 'Interact':
        this.openOperatorMode.perform();
        break;
    }
  }

  openCodeMode = restartableTask(async () => {
    let topMostStackItems = this.operatorModeStateService.topMostStackItems();
    let topMostStackItem;
    let counter = 0;
    do {
      counter++;
      topMostStackItem = topMostStackItems[topMostStackItems.length - counter];
    } while (topMostStackItem.type !== 'card' && counter < topMostStackItems.length);
    if (!topMostStackItem || topMostStackItem.type !== 'card') return;

    let realmURL = await this.cardService.getRealmURL(topMostStackItem.card);
    let path = topMostStackItem.card.id.replace(realmURL!.toString(), '') + '.json';
    let pathArray = path.split('/');
    pathArray.pop();
    let openDirs = pathArray.length > 0 ? pathArray.join('/') + '/' : undefined;
    this.router.transitionTo('code', { queryParams: { openDirs, path }});
  });

  openOperatorMode = restartableTask(async () => {
    let operatorModeState = this.operatorModeStateService.serialize();
    this.router.transitionTo('card', { queryParams: { operatorModeEnabled: true, operatorModeState }});
  });
}
