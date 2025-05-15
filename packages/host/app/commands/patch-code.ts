import { inject as service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import OperatorModeStateService from '../services/operator-mode-state-service';

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
  @service declare private operatorModeStateService: OperatorModeStateService;
  description = `Apply code changes to file and then apply lint fixes`;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { PatchCodeInput } = commandModule;
    return PatchCodeInput;
  }

  protected async run(
    input: BaseCommandModule.PatchCodeInput,
  ): Promise<BaseCommandModule.LintAndFixResult> {
    let { fileUrl, fileName, codeBlocks, isNewFile } = input;

    let source = isNewFile
      ? ''
      : (await this.cardService.getSource(new URL(fileUrl))).content;

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
    let realmURL = this.operatorModeStateService.realmURL;

    let lintAndFixResult = await lintAndFixCommand.execute({
      realm: realmURL.href,
      fileContent: patchedCode,
    });

    if (isNewFile) {
      let isFileUrlAvailable =
        (await this.cardService.getSource(new URL(fileName, realmURL)))
          .status === 404;
      if (!isFileUrlAvailable) {
        // Try sequential numbering to find an available filename
        let counter = 1;
        let baseFileName = fileName.replace(/\.([^.]+)$/, '');
        let extension = fileName.match(/\.([^.]+)$/)?.[0] || '';

        while (!isFileUrlAvailable && counter < 100) {
          // Limit to prevent infinite loop
          let newFileName = `${baseFileName}-${counter}${extension}`;
          isFileUrlAvailable =
            (await this.cardService.getSource(new URL(newFileName, realmURL)))
              .status === 404;

          if (isFileUrlAvailable) {
            fileName = newFileName;
          } else {
            counter++;
          }
        }
      }
      fileUrl = new URL(fileName, realmURL).href;
    }

    await this.cardService.saveSource(
      new URL(fileUrl),
      lintAndFixResult.output,
      'bot-patch',
    );

    return lintAndFixResult;
  }
}
