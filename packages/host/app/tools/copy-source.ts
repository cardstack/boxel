import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type CardService from '../services/card-service';
import type * as BaseToolModule from '@cardstack/base/command';

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
    let r = await this.cardService.copySource(
      rri(input.originSourceIdentifier),
      rri(input.destinationSourceIdentifier),
    );
    let commandModule = await this.loadToolModule();
    const { CopySourceResult } = commandModule;
    if (r.ok && r.url) {
      return new CopySourceResult({ identifier: r.url });
    }
    return new CopySourceResult({});
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { CopySourceTool as CopySourceCommand };
