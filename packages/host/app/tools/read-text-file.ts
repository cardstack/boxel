import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type NetworkService from '../services/network';

export default class ReadTextFileTool extends HostBaseTool<
  typeof BaseToolModule.ReadTextFileInput,
  typeof BaseToolModule.FileContents
> {
  @service declare private network: NetworkService;

  description = `Read a text file from a realm, such as a module or a card.`;
  static actionVerb = 'Read';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ReadTextFileInput } = commandModule;
    return ReadTextFileInput;
  }

  requireInputFields = ['path'];

  protected async run(
    input: BaseToolModule.ReadTextFileInput,
  ): Promise<BaseToolModule.FileContents> {
    let url = input.realm
      ? new URL(input.path, input.realm)
      : new URL(input.path);
    let response = await this.network.authedFetch(url, {
      headers: { Accept: 'text/plain' },
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

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { ReadTextFileTool as ReadTextFileCommand };
