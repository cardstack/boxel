import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import { SupportedMimeType } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type NetworkService from '../services/network';
import type * as BaseToolModule from '@cardstack/base/command';

export default class CopyCardAsMarkdownTool extends HostBaseTool<
  typeof BaseToolModule.CardIdCard,
  undefined
> {
  @service declare private network: NetworkService;

  description = 'Copy a card as markdown to the clipboard';
  static actionVerb = 'Copy';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.CardIdCard;
  }

  requireInputFields = ['cardId'];

  protected async run(input: BaseToolModule.CardIdCard): Promise<undefined> {
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

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { CopyCardAsMarkdownTool as CopyCardAsMarkdownCommand };
