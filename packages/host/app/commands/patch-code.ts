import { inject as service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import ApplySearchReplaceBlockCommand from './apply-search-replace-block';
import LintAndFixCommand from './lint-and-fix';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';

export default class PatchCodeCommand extends HostBaseCommand<
  typeof BaseCommandModule.PatchCodeInput,
  typeof BaseCommandModule.LintAndFixResult
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;
  description = `Apply code changes to file and then apply lint fixes`;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { PatchCodeInput } = commandModule;
    return PatchCodeInput;
  }

  protected async run(
    input: BaseCommandModule.PatchCodeInput,
  ): Promise<BaseCommandModule.LintAndFixResult> {
    let { fileUrl, codeBlocks } = input;

    let source = await this.cardService.getSource(new URL(fileUrl));

    let applySearchReplaceBlockCommand = new ApplySearchReplaceBlockCommand(
      this.commandContext,
    );

    let patchedCode = source;
    for (const codeBlock of codeBlocks) {
      let { resultContent } = await applySearchReplaceBlockCommand.execute({
        fileContent: patchedCode,
        codeBlock: codeBlock,
      });
      patchedCode = resultContent;
    }

    // lint and fix the final result
    let lintAndFixCommand = new LintAndFixCommand(this.commandContext);
    let realmURL = this.realm.url(fileUrl);

    let lintAndFixResult = await lintAndFixCommand.execute({
      realm: realmURL,
      fileContent: patchedCode,
    });
    await this.cardService.saveSource(
      new URL(fileUrl),
      lintAndFixResult.output,
      'bot-patch',
    );

    return lintAndFixResult;
  }
}
