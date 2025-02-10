import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';
import NetworkService from '../services/network';

export class WriteTextFileCommand extends HostBaseCommand<
  typeof BaseCommandModule.WriteTextFileInput
> {
  @service private declare network: NetworkService;

  description = `Write a text file to a realm, such as a module or a card.`;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { WriteTextFileInput } = commandModule;
    return WriteTextFileInput;
  }

  protected async run(
    input: BaseCommandModule.WriteTextFileInput,
  ): Promise<undefined> {
    let url = new URL(input.path, input.realm);
    if (!input.overwrite) {
      let existing = await this.network.authedFetch(url);

      if (existing.ok || existing.status === 406) {
        throw new Error(`File already exists: ${input.path}`);
      }

      if (existing.status !== 404) {
        throw new Error(
          `Error checking if file exists at ${input.path}: ${existing.statusText} (${existing.status})`,
        );
      }
    }
    let response = await this.network.authedFetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.card+source',
      },
      body: input.content,
    });
    if (!response.ok) {
      throw new Error(`Failed to write file ${url}: ${response.statusText}`);
    }
  }
}

export default WriteTextFileCommand;
