import { service } from '@ember/service';

import { APP_BOXEL_ROOM_SKILLS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class AddSkillsToRoomCommand extends HostBaseCommand<
  typeof BaseCommandModule.AddSkillsToRoomInput
> {
  @service declare private matrixService: MatrixService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { AddSkillsToRoomInput } = commandModule;
    return AddSkillsToRoomInput;
  }

  protected async run(
    input: BaseCommandModule.AddSkillsToRoomInput,
  ): Promise<undefined> {
    let { matrixService } = this;
    let { roomId, skills } = input;
    let roomSkillEventIds = await matrixService.addSkillCardsToRoomHistory(
      skills,
      roomId,
      { includeComputeds: true, maybeRelativeURL: null },
    );
    await matrixService.updateStateEvent(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      '',
      async (oldContent: Record<string, any>) => {
        return {
          enabledEventIds: [
            ...new Set([
              ...(oldContent.enabledEventIds || []),
              ...roomSkillEventIds,
            ]),
          ],
          disabledEventIds: [...(oldContent.disabledEventIds || [])],
        };
      },
    );
  }
}
