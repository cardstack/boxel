import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedArray } from 'tracked-built-ins';

import { TrackedSet } from 'tracked-built-ins';

import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import AiAssistantAttachmentPicker from './index';

export default class AiAssistantCardPickerUsage extends Component {
  cardIds: TrackedArray<string> = new TrackedArray([]);
  @tracked maxNumberOfCards: number | undefined = undefined;
  @tracked autoAttachedCardIds?: TrackedSet<string> = new TrackedSet();
  @tracked autoAttachedFile?: FileDef | undefined;
  @tracked filesToAttach: TrackedArray<FileDef> = new TrackedArray([]);

  @action chooseCard(cardId: string) {
    if (!this.cardIds.includes(cardId)) {
      this.cardIds.push(cardId);
    }
  }

  @action removeCard(cardId: string) {
    let index = this.cardIds.findIndex((id) => id === cardId);
    this.cardIds.splice(index, 1);
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
          @autoAttachedCardIds={{this.autoAttachedCardIds}}
          @cardIdsToAttach={{this.cardIds}}
          @chooseCard={{this.chooseCard}}
          @removeCard={{this.removeCard}}
          @chooseFile={{this.chooseFile}}
          @removeFile={{this.removeFile}}
          @autoAttachedFile={{this.autoAttachedFile}}
          @filesToAttach={{this.filesToAttach}}
          as |AttachedItems AttachButton|
        >
          <AttachedItems />
          <AttachButton />
        </AiAssistantAttachmentPicker>
        <CardCatalogModal />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='cardIdsToAttach'
          @description='An array of card ids to attach to the message.'
          @value={{this.cardIds}}
        />
        <Args.Object
          @name='autoAttachedCard'
          @description='A card automatically attached to the message from the top of the stack.'
          @value={{this.autoAttachedCardIds}}
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
          @name='cardChoosingOwner'
          @description='the owner of the life time for the card resource of the chosen card'
          @value={{this}}
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
