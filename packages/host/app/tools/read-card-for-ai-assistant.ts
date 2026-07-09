import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseToolModule from 'https://cardstack.com/base/command';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import HostBaseTool from '../lib/host-base-tool';

import type MatrixService from '../services/matrix-service';
import type StoreService from '../services/store';

export default class ReadCardForAssistantTool extends HostBaseTool<
  typeof BaseToolModule.CardIdCard,
  typeof BaseToolModule.CardForAttachmentCard
> {
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;

  static actionVerb = 'Send';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CardIdCard } = commandModule;
    return CardIdCard;
  }

  requireInputFields = ['cardId'];

  protected async run(
    input: BaseToolModule.CardIdCard,
  ): Promise<BaseToolModule.CardForAttachmentCard> {
    let { matrixService } = this;

    await matrixService.ready;
    let maybeCard = await this.store.get<CardDef>(input.cardId);
    if (isCardInstance(maybeCard)) {
      let cardFileDef = (
        await matrixService.uploadCards([maybeCard])
      )[0] as FileDef;
      let commandModule = await this.loadToolModule();
      const { CardForAttachmentCard } = commandModule;
      return new CardForAttachmentCard({ cardForAttachment: cardFileDef });
    } else {
      console.error(`Failed to read card for AI assistant: ${maybeCard}`);
      throw new Error(maybeCard.message);
    }
  }
}
