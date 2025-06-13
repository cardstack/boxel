import { service } from '@ember/service';

import { CardDef } from 'https://cardstack.com/base/card-api';
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

  protected async run(
    input: BaseCommandModule.CardIdCard,
  ): Promise<BaseCommandModule.CardForAttachmentCard> {
    let { matrixService } = this;

    await matrixService.ready;
    let card = await this.store.get<CardDef>(input.cardId);
    let cardFileDef = (await matrixService.uploadCards([card]))[0] as FileDef;
    let commandModule = await this.loadCommandModule();
    const { CardForAttachmentCard } = commandModule;
    return new CardForAttachmentCard({ cardForAttachment: cardFileDef });
  }
}
