import { service } from '@ember/service';

import ENV from '@cardstack/host/config/environment';

import type * as BaseCommandModule from '@cardstack/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

const { defaultSystemCardId } = ENV;

export default class GetUserSystemCardCommand extends HostBaseCommand<
  undefined,
  typeof BaseCommandModule.GetUserSystemCardResult
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Get';
  description = "Gets the current user's active system card ID";

  async getInputType() {
    return undefined;
  }

  protected async run(): Promise<BaseCommandModule.GetUserSystemCardResult> {
    await this.matrixService.ready;
    let commandModule = await this.loadCommandModule();
    const { GetUserSystemCardResult } = commandModule;

    const systemCard = this.matrixService.systemCard;
    const cardId = systemCard?.id ?? undefined;
    return new GetUserSystemCardResult({
      cardId,
      isDefault: !cardId || cardId === defaultSystemCardId,
    });
  }
}
