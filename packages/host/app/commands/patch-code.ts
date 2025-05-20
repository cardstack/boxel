import { inject as service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { parseSearchReplace } from '../lib/search-replace-block-parsing';

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

    let getSourceResult = await this.cardService.getSource(new URL(fileUrl));
    let fileExists = getSourceResult.status !== 404;
    let fileHasContent = fileExists && getSourceResult.content.trim() !== '';
    let source = fileExists && fileHasContent ? getSourceResult.content : '';

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

    let isCreatingNewFile = false;
    if (codeBlocks.length === 1) {
      let searchReplaceBlock = codeBlocks[0];
      let searchPortion = parseSearchReplace(searchReplaceBlock).searchContent;
      if (searchPortion.trim() === '') {
        isCreatingNewFile = true;
      }
    }

    if (isCreatingNewFile && fileExists && fileHasContent) {
      let counter = 1;
      let baseFileName = fileUrl.replace(/\.([^.]+)$/, '');
      let extension = fileUrl.match(/\.([^.]+)$/)?.[0] || '';

      let newFileUrl = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        newFileUrl = `${baseFileName}-${counter}${extension}`;
        let getSourceResult = await this.cardService.getSource(
          new URL(newFileUrl),
        );
        if (counter < 100 && getSourceResult.status !== 404) {
          counter++;
        } else {
          fileUrl = newFileUrl;
          break;
        }
      }
    }

    await this.cardService.saveSource(
      new URL(fileUrl),
      lintAndFixResult.output,
      'bot-patch',
    );

    return lintAndFixResult;
  }
}
