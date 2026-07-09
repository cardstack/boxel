import { RealmPaths } from '@cardstack/runtime-common';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import GetAvailableRealmIdentifiersTool from './get-available-realm-identifiers';

export default class ValidateRealmTool extends HostBaseTool<
  typeof BaseToolModule.ValidateRealmInput,
  typeof BaseToolModule.ValidateRealmResult
> {
  description = 'Validate that a realm URL is available and normalize it';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ValidateRealmInput } = commandModule;
    return ValidateRealmInput;
  }

  requireInputFields = ['realmIdentifier'];

  protected async run(
    input: BaseToolModule.ValidateRealmInput,
  ): Promise<BaseToolModule.ValidateRealmResult> {
    let realmIdentifier = new RealmPaths(new URL(input.realmIdentifier)).url;

    let { realmIdentifiers } = await new GetAvailableRealmIdentifiersTool(
      this.commandContext,
    ).execute();

    if (!realmIdentifiers.includes(realmIdentifier)) {
      throw new Error(`Invalid realm: ${realmIdentifier}`);
    }

    let commandModule = await this.loadToolModule();
    const { ValidateRealmResult } = commandModule;
    return new ValidateRealmResult({ realmIdentifier });
  }
}
