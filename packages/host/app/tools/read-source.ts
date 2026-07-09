import { service } from '@ember/service';

import { SupportedMimeType } from '@cardstack/runtime-common';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type NetworkService from '../services/network';

export default class ReadSourceTool extends HostBaseTool<
  typeof BaseToolModule.ReadSourceInput,
  typeof BaseToolModule.FileContents
> {
  @service declare private network: NetworkService;

  description = `Read a card source file from a realm.`;
  static actionVerb = 'Read';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ReadSourceInput } = commandModule;
    return ReadSourceInput;
  }

  requireInputFields = ['path'];

  protected async run(
    input: BaseToolModule.ReadSourceInput,
  ): Promise<BaseToolModule.FileContents> {
    let url = input.realm
      ? new URL(input.path, input.realm)
      : new URL(input.path);
    let response = await this.network.authedFetch(url, {
      headers: { Accept: SupportedMimeType.CardSource },
    });

    let { FileContents } = await this.loadToolModule();
    if (response.ok) {
      return new FileContents({
        content: await response.text(),
      });
    }
    throw new Error(`Error reading file ${url}: ${response.statusText}`);
  }
}
