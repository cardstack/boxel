import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class SetUserSystemCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.CardIdCard,
  undefined
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Set';
  description = "Sets the current user's preferred system card";

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CardIdCard } = commandModule;
    return CardIdCard;
  }

  requireInputFields = ['cardId'];

  protected async run(input: BaseCommandModule.CardIdCard): Promise<undefined> {
    if (!input.cardId) {
      throw new Error('cardId is required');
    }
    await this.matrixService.ready;
    await this.matrixService.setUserSystemCard(input.cardId);
    return undefined;
  }
}
