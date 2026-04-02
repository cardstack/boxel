import { service } from '@ember/service';

import { isBotTriggerEvent } from '@cardstack/runtime-common';

import HostBaseCommand from '../../lib/host-base-command';

import type MatrixService from '../../services/matrix-service';
import type * as BaseCommandModule from '@cardstack/base/command';
import type { BotTriggerEvent } from '@cardstack/base/matrix-event';

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

  requireInputFields = ['roomId', 'type', 'input', 'realm'];

  protected async run(
    input: BaseCommandModule.SendBotTriggerEventInput,
  ): Promise<undefined> {
    await this.matrixService.ready;
    let userId = this.matrixService.userId;
    if (!userId) {
      throw new Error('userId is required to send bot trigger events');
    }

    const botTriggerEventType = 'app.boxel.bot-trigger';
    let event = {
      type: botTriggerEventType,
      content: {
        type: input.type,
        input: input.input,
        realm: input.realm,
        userId,
      },
    } as BotTriggerEvent;

    if (!isBotTriggerEvent(event)) {
      throw new Error(`Invalid bot trigger event payload`);
    }

    await this.matrixService.sendEvent(input.roomId, event.type, event.content);
  }
}
