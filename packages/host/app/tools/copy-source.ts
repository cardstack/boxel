import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type CardService from '../services/card-service';

export default class CopySourceTool extends HostBaseTool<
  typeof BaseToolModule.CopySourceInput,
  typeof BaseToolModule.CopySourceResult
> {
  @service declare private cardService: CardService;

  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CopySourceInput } = commandModule;
    return CopySourceInput;
  }

  requireInputFields = [
    'originSourceIdentifier',
    'destinationSourceIdentifier',
  ];

  protected async run(
    input: BaseToolModule.CopySourceInput,
  ): Promise<BaseToolModule.CopySourceResult> {
    const originSourceIdentifier = new URL(input.originSourceIdentifier);
    const destinationSourceIdentifier = new URL(
      input.destinationSourceIdentifier,
    );
    let r = await this.cardService.copySource(
      originSourceIdentifier,
      destinationSourceIdentifier,
    );
    let commandModule = await this.loadToolModule();
    const { CopySourceResult } = commandModule;
    if (r.ok && r.url) {
      return new CopySourceResult({ identifier: r.url });
    }
    return new CopySourceResult({});
  }
}
