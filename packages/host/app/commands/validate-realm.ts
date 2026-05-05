import { RealmPaths } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import GetAvailableRealmIdentifiersCommand from './get-available-realm-identifiers';

export default class ValidateRealmCommand extends HostBaseCommand<
  typeof BaseCommandModule.ValidateRealmInput,
  typeof BaseCommandModule.ValidateRealmResult
> {
  description = 'Validate that a realm URL is available and normalize it';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ValidateRealmInput } = commandModule;
    return ValidateRealmInput;
  }

  requireInputFields = ['realmIdentifier'];

  protected async run(
    input: BaseCommandModule.ValidateRealmInput,
  ): Promise<BaseCommandModule.ValidateRealmResult> {
    let realmIdentifier = new RealmPaths(new URL(input.realmIdentifier)).url;

    let { realmIdentifiers } = await new GetAvailableRealmIdentifiersCommand(
      this.commandContext,
    ).execute();

    if (!realmIdentifiers.includes(realmIdentifier)) {
      throw new Error(`Invalid realm: ${realmIdentifier}`);
    }

    let commandModule = await this.loadCommandModule();
    const { ValidateRealmResult } = commandModule;
    return new ValidateRealmResult({ realmIdentifier });
  }
}
