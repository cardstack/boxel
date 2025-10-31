import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type NetworkService from '../services/network';
import type RealmService from '../services/realm';

export default class WriteTextFileCommand extends HostBaseCommand<
  typeof BaseCommandModule.WriteTextFileInput
> {
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;

  description = `Write a text file to a realm, such as a module or a card.`;
  static actionVerb = 'Write';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { WriteTextFileInput } = commandModule;
    return WriteTextFileInput;
  }

  requireInputFields = ['path', 'content'];

  protected async run(
    input: BaseCommandModule.WriteTextFileInput,
  ): Promise<undefined> {
    let realm;
    if (input.realm) {
      realm = this.realm.realmOfURL(new URL(input.realm));
      if (!realm) {
        throw new Error(`Invalid or unknown realm provided: ${input.realm}`);
      }
    }
    if (input.path.startsWith('/')) {
      input.path = input.path.slice(1);
    }
    let url = new URL(input.path, realm?.href);
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
