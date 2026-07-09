import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type MatrixService from '../services/matrix-service';

export default class SetUserSystemCardTool extends HostBaseTool<
  typeof BaseToolModule.CardIdCard,
  undefined
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Set';
  description = "Sets the current user's preferred system card";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CardIdCard } = commandModule;
    return CardIdCard;
  }

  protected async run(input: BaseToolModule.CardIdCard): Promise<undefined> {
    await this.matrixService.ready;
    await this.matrixService.setUserSystemCard(input.cardId || undefined);
    return undefined;
  }
}
