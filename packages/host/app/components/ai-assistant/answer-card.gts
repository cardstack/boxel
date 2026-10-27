import { on } from '@ember/modifier';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import Ellipsis from '@cardstack/boxel-icons/ellipsis';

import { CardEmbed } from '@cardstack/pretui/components/card-embed';
import { IconButton } from '@cardstack/pretui/components/icon-button';
import { Menu } from '@cardstack/pretui/components/menu';

import {
  cardTypeDisplayName,
  cardTypeIcon,
  getMenuItems,
} from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';
import { cardMenuEntries } from '@cardstack/host/lib/card-menu-entries';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type ToolService from '@cardstack/host/services/tool-service';

import type { CardDef, Format } from '@cardstack/base/card-api';

interface Signature {
  Args: {
    card: CardDef;
    format: Format;
  };
}

// A card an answer shows as a block: Pret UI's CardEmbed with its hat (the
// card's type, its icon and its menu), as a tool row shows the card a call
// made. The slot around it stays the rounded light box, and a click on the
// card still opens Quick Look.
export default class AnswerCard extends Component<Signature> {
  @service declare private toolService: ToolService;
  @service declare private realm: RealmService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  private get kind() {
    return cardTypeDisplayName(this.args.card);
  }

  private get menuItems() {
    let realmURL = this.operatorModeStateService.realmURL;
    let items =
      this.args.card[getMenuItems]?.({
        canEdit: false,
        cardCrudFunctions: {},
        menuContext: 'ai-assistant',
        menuContextParams: {
          activeRealmURL: realmURL,
          canEditActiveRealm: realmURL ? this.realm.canWrite(realmURL) : false,
        },
        toolContext: this.toolService.toolContext,
      }) ?? [];
    return cardMenuEntries(items);
  }

  <template>
    <CardEmbed
      class='answer-card'
      @format='embedded'
      @hat={{true}}
      @fill={{true}}
      @kind={{this.kind}}
      @icon={{cardTypeIcon @card}}
      data-test-answer-card
    >
      <:actions>
        {{#if this.menuItems.length}}
          <Menu @items={{this.menuItems}} @align='end' @label='Options'>
            <:trigger as |_open toggle|>
              <IconButton
                class='answer-card-options'
                @label='Options'
                @icon={{Ellipsis}}
                @appearance='plain'
                @size='xs'
                data-test-answer-card-options
                {{on 'click' toggle}}
              />
            </:trigger>
          </Menu>
        {{/if}}
      </:actions>
      <:default>
        <CardRenderer
          @card={{@card}}
          @format={{@format}}
          @displayContainer={{false}}
        />
      </:default>
    </CardEmbed>
    <style scoped>
      /* the hat is a gray band over the card's white face: the frame's,
         not the card's, so it never reads as part of the card */
      .answer-card {
        --pretui-embed-min: 0;
        min-height: 0;
      }
      .answer-card :deep(.pretui-embed-hat) {
        background-color: var(--boxel-100);
        box-shadow: 0 1px 0 var(--boxel-200);
      }
      /* the menu's trigger fits the hat's line, in the hat's gray */
      .answer-card-options {
        color: var(--boxel-450);
      }
    </style>
  </template>
}
