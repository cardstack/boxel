import { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import { markdownToHtml } from '@cardstack/runtime-common';
import { basicMappings } from '@cardstack/runtime-common/helpers/ai';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { CardMessageContent } from 'https://cardstack.com/base/matrix-event';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';

export class SendAIAssistantMessageCommand extends HostBaseCommand<
  typeof BaseCommandModule.SendAIAssistantMessageInput,
  typeof BaseCommandModule.SendAIAssistantMessageResult
> {
  @service private declare cardService: CardService;
  @service private declare commandService: CommandService;
  @service private declare matrixService: MatrixService;
  #cardAPI?: typeof CardAPI;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SendAIAssistantMessageInput } = commandModule;
    return SendAIAssistantMessageInput;
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
    input: BaseCommandModule.SendAIAssistantMessageInput,
  ): Promise<BaseCommandModule.SendAIAssistantMessageResult> {
    let { commandService, loaderService, matrixService } = this;
    let roomId = input.roomId;
    let html = markdownToHtml(input.prompt);
    let mappings = await basicMappings(loaderService.loader);
    let tools = [];
    let requireToolCall = input.requireCommandCall ?? false;
    if (requireToolCall && input.commands?.length > 1) {
      throw new Error('Cannot require tool call and have multiple commands');
    }
    for (let { command, autoExecute } of input.commands ?? []) {
      let cardAPI = await this.loadCardAPI();
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

    let attachedCardsEventIds = await matrixService.addCardsToRoom(
      input.attachedCards ?? [],
      roomId,
    );

    let clientGeneratedId = input.clientGeneratedId ?? uuidv4();

    let { event_id } = await matrixService.sendEvent(roomId, 'm.room.message', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: input.prompt || '',
      format: 'org.matrix.custom.html',
      formatted_body: html,
      clientGeneratedId,
      data: {
        attachedCardsEventIds,
        context: {
          tools,
          requireToolCall,
        },
      },
    } as CardMessageContent);
    let commandModule = await this.loadCommandModule();
    const { SendAIAssistantMessageResult } = commandModule;
    return new SendAIAssistantMessageResult({ eventId: event_id });
  }
}

export default SendAIAssistantMessageCommand;
