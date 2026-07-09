import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';

export default class GetRealmOfResourceIdentifierTool extends HostBaseTool<
  typeof BaseToolModule.GetRealmOfResourceIdentifierInput,
  typeof BaseToolModule.GetRealmOfResourceIdentifierResult
> {
  @service declare private realm: RealmService;

  description = 'Get the realm that contains a given resource';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { GetRealmOfResourceIdentifierInput } = commandModule;
    return GetRealmOfResourceIdentifierInput;
  }

  requireInputFields = ['resourceIdentifier'];

  protected async run(
    input: BaseToolModule.GetRealmOfResourceIdentifierInput,
  ): Promise<BaseToolModule.GetRealmOfResourceIdentifierResult> {
    let commandModule = await this.loadToolModule();
    const { GetRealmOfResourceIdentifierResult } = commandModule;
    const realmIdentifier = this.realm.realmOf(rri(input.resourceIdentifier));
    return new GetRealmOfResourceIdentifierResult({
      realmIdentifier: realmIdentifier ?? '',
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { GetRealmOfResourceIdentifierTool as GetRealmOfResourceIdentifierCommand };
