import { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseToolModule from 'https://cardstack.com/base/command';
import type { FileDef } from 'https://cardstack.com/base/file-api';
import type {
  CardMessageContent,
  Tool,
} from 'https://cardstack.com/base/matrix-event';

import HostBaseTool from '../lib/host-base-tool';
import { addPatchTools } from '../tools/utils';

import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type ToolService from '../services/tool-service';

export default class SendAiAssistantMessageTool extends HostBaseTool<
  typeof BaseToolModule.SendAiAssistantMessageInput,
  typeof BaseToolModule.SendAiAssistantMessageResult
> {
  @service declare private cardService: CardService;
  @service declare private toolService: ToolService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  #cardAPI?: typeof CardAPI;

  static actionVerb = 'Send';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { SendAiAssistantMessageInput } = commandModule;
    return SendAiAssistantMessageInput;
  }

  requireInputFields = ['roomId'];

  async loadCardAPI() {
    if (!this.#cardAPI) {
      this.#cardAPI = await this.loaderService.loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
    }
    return this.#cardAPI;
  }

  protected async run(
    input: BaseToolModule.SendAiAssistantMessageInput,
  ): Promise<BaseToolModule.SendAiAssistantMessageResult> {
    let { matrixService, operatorModeStateService } = this;
    let roomId = input.roomId;
    let requireToolCall = input.requireCommandCall ?? false;
    let cardAPI = await this.loadCardAPI();

    let patchableCards = input.attachedCards.filter((c) =>
      this.realm.canWrite(c.id),
    );
    let tools: Tool[] = await addPatchTools(
      this.commandContext,
      patchableCards,
      cardAPI,
    );

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
    context.requireToolCall = requireToolCall;
    context.tools = tools;
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
