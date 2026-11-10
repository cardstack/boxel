import { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import HostBaseTool from '../lib/host-base-tool';

import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type ToolService from '../services/tool-service';
import type * as CardAPI from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';
import type { FileDef } from '@cardstack/base/file-api';
import type { CardMessageContent } from '@cardstack/base/matrix-event';

export default class SendAiAssistantMessageTool extends HostBaseTool<
  typeof BaseToolModule.SendAiAssistantMessageInput,
  typeof BaseToolModule.SendAiAssistantMessageResult
> {
  @service declare private cardService: CardService;
  @service declare private toolService: ToolService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  static actionVerb = 'Send';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { SendAiAssistantMessageInput } = commandModule;
    return SendAiAssistantMessageInput;
  }

  requireInputFields = ['roomId'];

  protected async run(
    input: BaseToolModule.SendAiAssistantMessageInput,
  ): Promise<BaseToolModule.SendAiAssistantMessageResult> {
    let { matrixService, operatorModeStateService } = this;
    let roomId = input.roomId;

    let attachedOpenCards: CardAPI.CardDef[] = [];
    if (input.openCardIds) {
      attachedOpenCards = input.attachedCards.filter((c: CardAPI.CardDef) =>
        input.openCardIds.includes(c.id),
      );
    }

    let files: FileDef[] | undefined;
    if (input.attachedFileIdentifiers) {
      files = input.attachedFileIdentifiers.map((url: string) =>
        this.matrixService.fileAPI.createFileDef({
          sourceUrl: url,
          name: url.split('/').pop(),
        }),
      );
    }
    if (files?.length) {
      files = await matrixService.uploadFiles(files);
    }
    await matrixService.updateSkillsAndToolsIfNeeded(roomId);
    let cardFileDefs = await matrixService.uploadCards(
      input.attachedCards ?? [],
    );

    let clientGeneratedId = input.clientGeneratedId ?? uuidv4();

    let context = await operatorModeStateService.getSummaryForAIBot(
      new Set(attachedOpenCards.map((c) => c.id)),
    );

    context.realmUrl = input.realmIdentifier;
    context.tools = [];
    context.functions = [];

    let { event_id } = await matrixService.sendEvent(roomId, 'm.room.message', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: input.prompt || '',
      format: 'org.matrix.custom.html',
      clientGeneratedId,
      data: {
        attachedFiles: files?.map((file: FileDef) => file.serialize()),
        attachedCards: cardFileDefs.map((file: FileDef) => file.serialize()),
        context,
      },
    } as CardMessageContent);
    let commandModule = await this.loadToolModule();
    const { SendAiAssistantMessageResult } = commandModule;
    return new SendAiAssistantMessageResult({ roomId, eventId: event_id });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { SendAiAssistantMessageTool as SendAiAssistantMessageCommand };
