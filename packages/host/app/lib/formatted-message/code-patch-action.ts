import Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';

import type { CodeData } from '@cardstack/host/components/ai-assistant/formatted-message';
import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';
import LoaderService from '@cardstack/host/services/loader-service';

export class CodePatchAction {
  eventId: string;
  fileUrl: string;
  index: number;
  searchReplaceBlock: string;

  @tracked patchCodeTaskState: 'ready' | 'applying' | 'applied' | 'failed' =
    'ready';
  @service declare private loaderService: LoaderService;
  @service declare private commandService: CommandService;
  @service declare private cardService: CardService;

  constructor(owner: Owner, codeData: CodeData) {
    setOwner(this, owner);
    if (
      !codeData.fileUrl ||
      !codeData.searchReplaceBlock ||
      !codeData.index ||
      !codeData.eventId
    ) {
      throw new Error(
        'fileUrl and searchReplaceBlock and index and eventId are required',
      );
    }
    this.fileUrl = codeData.fileUrl;
    this.index = codeData.index;
    this.eventId = codeData.eventId;
    this.searchReplaceBlock = codeData.searchReplaceBlock;
  }

  patchCodeTask = dropTask(async () => {
    this.patchCodeTaskState = 'applying';
    try {
      this.commandService.patchCode(this.fileUrl, [
        {
          codeBlock: this.searchReplaceBlock,
          eventId: this.eventId,
          index: this.index,
        },
      ]);
      this.patchCodeTaskState = 'applied';
    } catch (error) {
      console.error(error);
      this.patchCodeTaskState = 'failed';
    }
  });
}
