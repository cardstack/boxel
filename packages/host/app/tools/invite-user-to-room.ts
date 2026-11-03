import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type MatrixService from '../services/matrix-service';
import type * as BaseToolModule from '@cardstack/base/command';

// Invites the AI bot or the submission bot to a room.
// `MatrixService.inviteUserToRoom` refuses a person: an end user's Matrix id
// is shown only to users who share a realm with them (ADR 011 §1.5), and
// `decideRoomInvite` says why the host can't check that for an invite.
export default class InviteUserToRoomTool extends HostBaseTool<
  typeof BaseToolModule.InviteUserToRoomInput
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Invite';

  description =
    'Invite the AI bot or the submission bot to a room. It cannot invite a person.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { InviteUserToRoomInput } = commandModule;
    return InviteUserToRoomInput;
  }

  requireInputFields = ['roomId', 'userId'];

  protected async run(
    input: BaseToolModule.InviteUserToRoomInput,
  ): Promise<undefined> {
    await this.matrixService.ready;
    let userId = this.matrixService.getFullUserId(input.userId);
    if (await this.matrixService.isUserInRoom(input.roomId, userId)) {
      throw new Error(`user already in room: ${userId}`);
    }
    await this.matrixService.inviteUserToRoom(input.roomId, userId);
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { InviteUserToRoomTool as InviteUserToRoomCommand };
