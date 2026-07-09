import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';
import type StoreService from '../services/store';

export default class ReadCardForAssistantCommand extends HostBaseCommand<
  typeof BaseCommandModule.CardIdCard,
  typeof BaseCommandModule.CardForAttachmentCard
> {
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;

  static actionVerb = 'Send';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CardIdCard } = commandModule;
    return CardIdCard;
  }

  requireInputFields = ['cardId'];

  protected async run(
    input: BaseCommandModule.CardIdCard,
  ): Promise<BaseCommandModule.CardForAttachmentCard> {
    let { matrixService } = this;

    await matrixService.ready;
    let maybeCard = await this.store.get<CardDef>(input.cardId);
    if (isCardInstance(maybeCard)) {
      let cardFileDef = (
        await matrixService.uploadCards([maybeCard])
      )[0] as FileDef;
      let commandModule = await this.loadCommandModule();
      const { CardForAttachmentCard } = commandModule;
      return new CardForAttachmentCard({ cardForAttachment: cardFileDef });
    } else {
      console.error(`Failed to read card for AI assistant: ${maybeCard}`);
      throw new Error(maybeCard.message);
    }
  }
}
