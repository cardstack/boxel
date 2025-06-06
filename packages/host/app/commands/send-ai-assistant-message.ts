import { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import {
  basicMappings,
  generateJsonSchemaForCardType,
  getPatchTool,
} from '@cardstack/runtime-common/helpers/ai';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { FileDef } from 'https://cardstack.com/base/file-api';
import type {
  CardMessageContent,
  Tool,
} from 'https://cardstack.com/base/matrix-event';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class SendAiAssistantMessageCommand extends HostBaseCommand<
  typeof BaseCommandModule.SendAiAssistantMessageInput,
  typeof BaseCommandModule.SendAiAssistantMessageResult
> {
  @service declare private cardService: CardService;
  @service declare private commandService: CommandService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;

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
    let {
      commandService,
      loaderService,
      matrixService,
      operatorModeStateService,
    } = this;
    let roomId = input.roomId;
    let mappings = await basicMappings(loaderService.loader);
    let tools: Tool[] = [];
    let requireToolCall = input.requireCommandCall ?? false;
    if (requireToolCall && input.commands?.length > 1) {
      throw new Error('Cannot require tool call and have multiple commands');
    }
    let cardAPI = await this.loadCardAPI();
    for (let { command, autoExecute } of input.commands ?? []) {
      // get a registered name for the command
      let name = commandService.registerCommand(command, autoExecute);
      tools.push({
        type: 'function',
        function: {
          name,
          description: command.description,
          parameters: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
              },
              ...(await command.getInputJsonSchema(cardAPI, mappings)),
            },
            required: ['attributes', 'description'],
          },
        },
      });
    }

    let attachedOpenCards: CardAPI.CardDef[] = [];
    if (input.openCardIds) {
      attachedOpenCards = input.attachedCards.filter((c: CardAPI.CardDef) =>
        input.openCardIds.includes(c.id),
      );
      for (let attachedOpenCard of attachedOpenCards) {
        let patchSpec = generateJsonSchemaForCardType(
          attachedOpenCard.constructor as typeof CardAPI.CardDef,
          cardAPI,
          mappings,
        );
        tools.push(getPatchTool(attachedOpenCard.id, patchSpec));
      }
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

    let context = operatorModeStateService.getSummaryForAIBot(
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
