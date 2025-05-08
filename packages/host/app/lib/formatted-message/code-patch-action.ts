import Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { service } from '@ember/service';

import { dropTask } from 'ember-concurrency';

import { ApplyButtonState } from '@cardstack/host/components/ai-assistant/apply-button';
import type { CodeData } from '@cardstack/host/components/ai-assistant/formatted-message';
import type CardService from '@cardstack/host/services/card-service';
import CommandService from '@cardstack/host/services/command-service';
import LoaderService from '@cardstack/host/services/loader-service';

export class CodePatchAction {
  roomId: string;
  eventId: string;
  fileUrl: string;
  index: number;
  searchReplaceBlock: string;

  @service declare private loaderService: LoaderService;
  @service declare private commandService: CommandService;
  @service declare private cardService: CardService;

  constructor(owner: Owner, codeData: CodeData) {
    setOwner(this, owner);
    if (
      !codeData.fileUrl ||
      !codeData.searchReplaceBlock ||
      codeData.index === undefined ||
      codeData.index === null ||
      !codeData.roomId ||
      !codeData.eventId
    ) {
      throw new Error(
        'fileUrl, searchReplaceBlock, index, roomId and eventId are required',
      );
    }
    this.fileUrl = codeData.fileUrl;
    this.index = codeData.index;
    this.eventId = codeData.eventId;
    this.roomId = codeData.roomId;
    this.searchReplaceBlock = codeData.searchReplaceBlock;
  }

  get patchCodeState() {
    return this.commandService.getCodePatchStatus(this);
  }

  get applyButtonState(): ApplyButtonState {
    let { patchCodeState } = this;
    if (patchCodeState === 'rejected') {
      return 'failed';
    }
    return patchCodeState as ApplyButtonState;
  }

  patchCodeTask = dropTask(async () => {
    try {
      await this.commandService.patchCode(this.roomId, this.fileUrl, [
        {
          codeBlock: this.searchReplaceBlock,
          eventId: this.eventId,
          index: this.index,
        },
      ]);
    } catch (error) {
      console.error(error);
      // this.patchCodeTaskState = 'failed'; TODO: ???
    }
  });
}
