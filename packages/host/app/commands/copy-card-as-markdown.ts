import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import { SupportedMimeType } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type NetworkService from '../services/network';

export default class CopyCardAsMarkdownCommand extends HostBaseCommand<
  typeof BaseCommandModule.CardIdCard,
  undefined
> {
  @service declare private network: NetworkService;

  description = 'Copy a card as markdown to the clipboard';
  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    return commandModule.CardIdCard;
  }

  requireInputFields = ['cardId'];

  protected async run(input: BaseCommandModule.CardIdCard): Promise<undefined> {
    let response = await this.network.authedFetch(input.cardId, {
      headers: { Accept: SupportedMimeType.Markdown },
    });
    if (response.ok) {
      let markdown = await response.text();
      if (!isTesting()) {
        await navigator.clipboard.writeText(markdown);
      }
    }
    return undefined;
  }
}
