import { service } from '@ember/service';

import { SupportedMimeType } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type NetworkService from '../services/network';

export default class ReadSourceCommand extends HostBaseCommand<
  typeof BaseCommandModule.ReadSourceInput,
  typeof BaseCommandModule.FileContents
> {
  @service declare private network: NetworkService;

  description = `Read a card source file from a realm.`;
  static actionVerb = 'Read';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ReadSourceInput } = commandModule;
    return ReadSourceInput;
  }

  requireInputFields = ['path'];

  protected async run(
    input: BaseCommandModule.ReadSourceInput,
  ): Promise<BaseCommandModule.FileContents> {
    let url = input.realm
      ? new URL(input.path, input.realm)
      : new URL(input.path);
    let response = await this.network.authedFetch(url, {
      headers: { Accept: SupportedMimeType.CardSource },
    });

    let { FileContents } = await this.loadCommandModule();
    if (response.ok) {
      return new FileContents({
        content: await response.text(),
      });
    }
    throw new Error(`Error reading file ${url}: ${response.statusText}`);
  }
}
