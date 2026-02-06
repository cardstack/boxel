import { service } from '@ember/service';

import { isBotTriggerCommand } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import {
  BOT_TRIGGER_EVENT_TYPE,
  type BotTriggerEvent,
} from 'https://cardstack.com/base/matrix-event';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class SendBotTriggerEventCommand extends HostBaseCommand<
  typeof BaseCommandModule.SendBotTriggerEventInput
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Send';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SendBotTriggerEventInput } = commandModule;
    return SendBotTriggerEventInput;
  }

  requireInputFields = ['roomId', 'type', 'input'];

  protected async run(
    input: BaseCommandModule.SendBotTriggerEventInput,
  ): Promise<undefined> {
    await this.matrixService.ready;

    let event = {
      type: BOT_TRIGGER_EVENT_TYPE,
      content: {
        type: input.type,
        input: input.input,
      },
    } as BotTriggerEvent;

    if (!isBotTriggerCommand(event)) {
      throw new Error(`Unsupported bot trigger event type: ${input.type}`);
    }

    await this.matrixService.sendEvent(input.roomId, event.type, event.content);
  }
}
