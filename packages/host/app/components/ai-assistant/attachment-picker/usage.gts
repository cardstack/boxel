import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedArray } from 'tracked-built-ins';

import { TrackedSet } from 'tracked-built-ins';

import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import { type FileDef } from 'https://cardstack.com/base/file-api';

import AiAssistantAttachmentPicker from './index';

export default class AiAssistantCardPickerUsage extends Component {
  cards: TrackedArray<CardDef> = new TrackedArray([]);
  @tracked maxNumberOfCards: number | undefined = undefined;
  @tracked autoAttachedCards?: TrackedSet<CardDef> = new TrackedSet();
  @tracked autoAttachedFile?: FileDef | undefined;
  @tracked filesToAttach: TrackedArray<FileDef> = new TrackedArray([]);

  @action chooseCard(card: CardDef) {
    if (!this.cards?.find((c) => c.id === card.id)) {
      this.cards.push(card);
    }
  }

  @action removeCard(card: CardDef) {
    let index = this.cards.findIndex((c) => c.id === card.id);
    this.cards.splice(index, 1);
  }

  @action chooseFile(file: FileDef) {
    if (!this.filesToAttach?.find((f) => f.sourceUrl === file.sourceUrl)) {
      this.filesToAttach.push(file);
    }
  }

  @action removeFile(file: FileDef) {
    let index = this.filesToAttach.findIndex(
      (f) => f.sourceUrl === file.sourceUrl,
    );
    this.filesToAttach.splice(index, 1);
  }

  <template>
    <FreestyleUsage @name='AiAssistant::AttachmentPicker'>
      <:description>
        Card picker for AI Assistant chat input. It allows to pick a card from
        the card catalog, or a file. Selected card is attached to the message in
        atom format.
      </:description>
      <:example>
        <AiAssistantAttachmentPicker
          @autoAttachedCards={{this.autoAttachedCards}}
          @cardsToAttach={{this.cards}}
          @chooseCard={{this.chooseCard}}
          @removeCard={{this.removeCard}}
          @chooseFile={{this.chooseFile}}
          @removeFile={{this.removeFile}}
          @maxNumberOfItemsToAttach={{this.maxNumberOfCards}}
          @autoAttachedFile={{this.autoAttachedFile}}
          @filesToAttach={{this.filesToAttach}}
          @submode={{'interact'}}
        />
        <CardCatalogModal />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='cardsToAttach'
          @description='An array of cards to attach to the message.'
          @value={{this.cards}}
        />
        <Args.Object
          @name='autoAttachedCard'
          @description='A card automatically attached to the message from the top of the stack.'
          @value={{this.autoAttachedCards}}
        />
        <Args.Object
          @name='autoAttachedFile'
          @description='A file automatically attached to the message.'
          @value={{this.autoAttachedFile}}
        />
        <Args.Object
          @name='filesToAttach'
          @description='An array of files to attach to the message.'
          @value={{this.filesToAttach}}
        />
        <Args.Action
          @name='chooseCard'
          @description='Action to be taken when a card is chosen'
          @value={{this.chooseCard}}
        />
        <Args.Action
          @name='removeCard'
          @description='Action to be taken when a card is removed'
          @value={{this.removeCard}}
        />
        <Args.Action
          @name='removeFile'
          @description='Action to be taken when a file is removed'
          @value={{this.removeFile}}
        />
        <Args.Number
          @name='maxNumberOfCards'
          @description='Maximum number of cards that can be added. If a value is not provided, there is no limit.'
          @onInput={{fn (mut this.maxNumberOfCards)}}
          @value={{this.maxNumberOfCards}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
