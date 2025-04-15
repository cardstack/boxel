import Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';

import ApplySearchReplaceBlockCommand from '@cardstack/host/commands/apply-search-replace-block';
import type { CodeData } from '@cardstack/host/components/ai-assistant/formatted-message';
import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';
import LoaderService from '@cardstack/host/services/loader-service';

export class CodePatchAction {
  fileUrl: string;
  searchReplaceBlock: string;

  @tracked patchCodeTaskState: 'ready' | 'applying' | 'applied' | 'failed' =
    'ready';
  @service declare private loaderService: LoaderService;
  @service declare private commandService: CommandService;
  @service declare private cardService: CardService;

  constructor(owner: Owner, codeData: CodeData) {
    setOwner(this, owner);
    if (!codeData.fileUrl || !codeData.searchReplaceBlock) {
      throw new Error('fileUrl and searchReplaceBlock are required');
    }
    this.fileUrl = codeData.fileUrl;
    this.searchReplaceBlock = codeData.searchReplaceBlock;
  }

  patchCodeTask = dropTask(async () => {
    this.patchCodeTaskState = 'applying';
    try {
      let source = await this.cardService.getSource(new URL(this.fileUrl));

      let applySearchReplaceBlockCommand = new ApplySearchReplaceBlockCommand(
        this.commandService.commandContext,
      );

      let { resultContent: patchedCode } =
        await applySearchReplaceBlockCommand.execute({
          fileContent: source,
          codeBlock: this.searchReplaceBlock,
        });

      await this.cardService.saveSource(new URL(this.fileUrl), patchedCode);

      this.patchCodeTaskState = 'applied';
    } catch (error) {
      console.error(error);
      this.patchCodeTaskState = 'failed';
    }
  });
}
