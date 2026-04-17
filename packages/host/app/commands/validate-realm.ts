import { RealmPaths } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import GetAvailableRealmUrlsCommand from './get-available-realm-urls';

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

  requireInputFields = ['realmUrl'];

  protected async run(
    input: BaseCommandModule.ValidateRealmInput,
  ): Promise<BaseCommandModule.ValidateRealmResult> {
    let realmUrl = new RealmPaths(new URL(input.realmUrl)).url;

    let { urls: realmUrls } = await new GetAvailableRealmUrlsCommand(
      this.commandContext,
    ).execute(undefined);

    if (!realmUrls.includes(realmUrl)) {
      throw new Error(`Invalid realm: ${realmUrl}`);
    }

    let commandModule = await this.loadCommandModule();
    const { ValidateRealmResult } = commandModule;
    return new ValidateRealmResult({ realmUrl });
  }
}
