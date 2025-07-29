import { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { FileDef } from 'https://cardstack.com/base/file-api';
import type {
  CardMessageContent,
  Tool,
} from 'https://cardstack.com/base/matrix-event';

import { addPatchTools } from '../commands/utils';
import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';

export default class SendAiAssistantMessageCommand extends HostBaseCommand<
  typeof BaseCommandModule.SendAiAssistantMessageInput,
  typeof BaseCommandModule.SendAiAssistantMessageResult
> {
  @service declare private cardService: CardService;
  @service declare private commandService: CommandService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  #cardAPI?: typeof CardAPI;

  static actionVerb = 'Send';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SendAiAssistantMessageInput } = commandModule;
    return SendAiAssistantMessageInput;
  }

  async loadCardAPI() {
    if (!this.#cardAPI) {
      this.#cardAPI = await this.loaderService.loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
    }
    return this.#cardAPI;
  }

  protected async run(
    input: BaseCommandModule.SendAiAssistantMessageInput,
  ): Promise<BaseCommandModule.SendAiAssistantMessageResult> {
    let { matrixService, operatorModeStateService } = this;
    let roomId = input.roomId;
    let requireToolCall = input.requireCommandCall ?? false;
    let cardAPI = await this.loadCardAPI();

    let patchableCards = input.attachedCards.filter((c) =>
      this.realm.canWrite(c.id),
    );
    let tools: Tool[] = await addPatchTools(patchableCards, cardAPI);

    let attachedOpenCards: CardAPI.CardDef[] = [];
    if (input.openCardIds) {
      attachedOpenCards = input.attachedCards.filter((c: CardAPI.CardDef) =>
        input.openCardIds.includes(c.id),
      );
    }

    let files: FileDef[] | undefined;
    if (input.attachedFileURLs) {
      files = input.attachedFileURLs.map((url: string) =>
        this.matrixService.fileAPI.createFileDef({
          sourceUrl: url,
          name: url.split('/').pop(),
        }),
      );
    }
    if (files?.length) {
      files = await matrixService.uploadFiles(files);
    }
    await matrixService.updateSkillsAndCommandsIfNeeded(roomId);
    let cardFileDefs = await matrixService.uploadCards(
      input.attachedCards ?? [],
    );

    let clientGeneratedId = input.clientGeneratedId ?? uuidv4();

    let context = await operatorModeStateService.getSummaryForAIBot(
      new Set(attachedOpenCards.map((c) => c.id)),
    );

    context.realmUrl = input.realmUrl;
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
    let commandModule = await this.loadCommandModule();
    const { SendAiAssistantMessageResult } = commandModule;
    return new SendAiAssistantMessageResult({ roomId, eventId: event_id });
  }
}
