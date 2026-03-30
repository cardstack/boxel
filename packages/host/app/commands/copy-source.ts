import { service } from '@ember/service';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type * as BaseCommandModule from '@cardstack/base/command';

export default class CopySourceCommand extends HostBaseCommand<
  typeof BaseCommandModule.CopySourceInput,
  typeof BaseCommandModule.CopySourceResult
> {
  @service declare private cardService: CardService;

  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CopySourceInput } = commandModule;
    return CopySourceInput;
  }

  requireInputFields = ['originSourceUrl', 'destinationSourceUrl'];

  protected async run(
    input: BaseCommandModule.CopySourceInput,
  ): Promise<BaseCommandModule.CopySourceResult> {
    const originSourceUrl = new URL(input.originSourceUrl);
    const destinationSourceUrl = new URL(input.destinationSourceUrl);
    let r = await this.cardService.copySource(
      originSourceUrl,
      destinationSourceUrl,
    );
    let commandModule = await this.loadCommandModule();
    const { CopySourceResult } = commandModule;
    if (r.ok && r.url) {
      return new CopySourceResult({ url: r.url });
    }
    return new CopySourceResult({});
  }
}
