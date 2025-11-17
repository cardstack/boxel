import { service } from '@ember/service';

import { SupportedMimeType } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type NetworkService from '../services/network';

export default class ReadTextFileCommand extends HostBaseCommand<
  typeof BaseCommandModule.ReadTextFileInput,
  typeof BaseCommandModule.FileContents
> {
  @service declare private network: NetworkService;

  description = `Read a text file from a realm, such as a module or a card.`;
  static actionVerb = 'Read';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ReadTextFileInput } = commandModule;
    return ReadTextFileInput;
  }

  requireInputFields = ['path'];

  protected async run(
    input: BaseCommandModule.ReadTextFileInput,
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
