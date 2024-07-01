import { fn } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedObject } from 'tracked-built-ins';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { IconX } from '@cardstack/boxel-ui/icons';

import ENV from '@cardstack/host/config/environment';

import { getCard } from '@cardstack/host/resources/card-resource';

import headerIcon from '../ai-assistant/ai-assist-icon@2x.webp';

import PillMenu from './index';
import type { PillMenuItem } from './index';

const { ownRealmURL } = ENV;
const sampleCardURLs = [`${ownRealmURL}Author/1`, `${ownRealmURL}BlogPost/1`];

export default class PillMenuUsage extends Component {
  resources = sampleCardURLs.map((url) =>
    getCard(this, () => url, {
      isLive: () => false,
    }),
  );
  @tracked headerIconURL = headerIcon;
  @tracked items: PillMenuItem[] = [];
  @tracked canAttachCard = false;
  @tracked content = 'You have selected the following cards:';

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    this.attachSampleCards.perform();
  }

  private attachSampleCards = restartableTask(async () => {
    let cards: CardDef[] = [];
    await Promise.all(
      this.resources.map(async (resource) => {
        await resource.loaded;
        if (resource.card) {
          cards.push(resource.card);
        }
      }),
    );
    let items = cards.map(
      (card) =>
        new TrackedObject({
          card,
          isActive: true,
        }),
    );
    this.items = items;
  });

  @action headerAction() {
    console.log('Header button clicked');
  }

  @action onChooseCard(card: CardDef) {
    this.items = [...this.items, new TrackedObject({ card, isActive: true })];
  }

  <template>
    <FreestyleUsage @name='PillMenu'>
      <:description>
        Component with a header and a list of card pills.
      </:description>
      <:example>
        <PillMenu
          @items={{this.items}}
          @headerIconURL={{this.headerIconURL}}
          @headerAction={{this.headerAction}}
          @canAttachCard={{this.canAttachCard}}
          @onChooseCard={{this.onChooseCard}}
        >
          <:title>
            Pill Menu
          </:title>
          <:header-action>
            <IconX width='10' height='10' />
          </:header-action>
          <:content>
            {{this.content}}
          </:content>
        </PillMenu>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @description='Cards to be displayed on the pill menu.'
          @value={{this.items}}
        />
        <Args.String
          @name='headerIconURL'
          @description='Optional header title icon url'
          @value={{this.headerIconURL}}
          @onInput={{fn (mut this.headerIconURL)}}
        />
        <Args.Action
          @name='headerAction'
          @description='Action to take when header button is clicked'
        />
        <Args.String
          @name='content'
          @description='Optional inner content block of the pill menu'
          @value={{this.content}}
          @onInput={{fn (mut this.content)}}
        />
        <Args.Bool
          @name='canAttachCard'
          @description='Whether the user can add more items to the menu'
          @defaultValue={{false}}
          @value={{this.canAttachCard}}
          @onInput={{fn (mut this.canAttachCard)}}
        />
        <Args.Action
          @name='onChooseCard'
          @description='Action to take when a card is selected from the catalog. Can only be used if \`@canAttachCard\` is set to true.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
