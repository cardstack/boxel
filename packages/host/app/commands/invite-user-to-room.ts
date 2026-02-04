import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class InviteUserToRoomCommand extends HostBaseCommand<
  typeof BaseCommandModule.InviteUserToRoomInput
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Invite';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { InviteUserToRoomInput } = commandModule;
    return InviteUserToRoomInput;
  }

  requireInputFields = ['roomId', 'userId'];

  protected async run(
    input: BaseCommandModule.InviteUserToRoomInput,
  ): Promise<undefined> {
    await this.matrixService.ready;
    let userId = this.matrixService.getFullUserId(input.userId);
    if (await this.matrixService.isUserInRoom(input.roomId, userId)) {
      throw new Error(`user already in room: ${userId}`);
    }
    await this.matrixService.inviteUserToRoom(input.roomId, userId);
  }
}
