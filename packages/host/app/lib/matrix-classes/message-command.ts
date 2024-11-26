import { setOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import { inject as service } from '@ember/service';

import type CommandService from '@cardstack/host/services/command-service';

type CommandStatus = 'applied' | 'ready' | 'applying';

export default class MessageCommand {
  constructor(
    public toolCallId: string,
    public name: string,
    public payload: any, //arguments of toolCall. Its not called arguments due to lint
    public eventId: string,
    private commandStatus: CommandStatus,
    owner: Owner,
  ) {
    setOwner(this, owner);
  }

  @service declare commandService: CommandService;

  get status() {
    if (
      this.commandService.currentlyExecutingCommandEventIds.has(this.eventId)
    ) {
      return 'applying';
    }

    return this.commandStatus;
  }
}
