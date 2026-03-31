import { service } from '@ember/service';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';
import type * as BaseCommandModule from '@cardstack/base/command';

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

  protected async run(input: BaseCommandModule.CardIdCard): Promise<undefined> {
    await this.matrixService.ready;
    await this.matrixService.setUserSystemCard(input.cardId || undefined);
    return undefined;
  }
}
