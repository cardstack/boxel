import { fn } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedObject } from 'tracked-built-ins';

import { IconX } from '@cardstack/boxel-ui/icons';

import ENV from '@cardstack/host/config/environment';

import { getCard } from '@cardstack/host/resources/card-resource';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import headerIcon from '../ai-assistant/ai-assist-icon@2x.webp';

import PillMenu from './index';

import type { PillMenuItem } from './index';

const { ownRealmURL } = ENV;
const sampleCardURLs = [`${ownRealmURL}Author/1`, `${ownRealmURL}BlogPost/1`];

export default class PillMenuUsage extends Component {
  headerIconURL = headerIcon;
  resources = sampleCardURLs.map((url) =>
    getCard(this, () => url, {
      isLive: () => false,
    }),
  );
  @tracked title = 'Pill Menu';
  @tracked isExpandableHeader = false;
  @tracked items: PillMenuItem[] = [];
  @tracked canAttachCard = false;

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

  private get activeItems() {
    return this.items.filter((item) => item.isActive);
  }

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
          @title={{this.title}}
          @isExpandableHeader={{this.isExpandableHeader}}
          @headerAction={{this.headerAction}}
          @items={{this.items}}
          @canAttachCard={{this.canAttachCard}}
          @onChooseCard={{this.onChooseCard}}
        >
          <:headerIcon>
            <img
              src={{this.headerIconURL}}
              width='18'
              height='18'
              alt='menu icon'
            />
          </:headerIcon>
          <:headerDetail>
            {{this.activeItems.length}}
            of
            {{this.items.length}}
            Items Are Active
          </:headerDetail>
          <:headerButton>
            <IconX width='10' height='10' alt='Close' />
          </:headerButton>
          <:content>
            You have selected the following cards:
          </:content>
        </PillMenu>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @description='Menu title displayed on the header'
          @value={{this.title}}
          @onInput={{fn (mut this.title)}}
        />
        <Args.Object
          @name='items'
          @description='Cards to be displayed on the pill menu.'
          @value={{this.items}}
        />
        <Args.Bool
          @name='isExpandableHeader'
          @description='Whether the menu content can be hidden or shown by clicking the header button.'
          @defaultValue={{false}}
          @value={{this.isExpandableHeader}}
          @onInput={{fn (mut this.isExpandableHeader)}}
        />
        <Args.Action
          @name='headerAction'
          @description='Action to take when header button is clicked.'
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
          @description='Action to take when a card is selected from the catalog. "@canAttachCard" must be set to true.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
