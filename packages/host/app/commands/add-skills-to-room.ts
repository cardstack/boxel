import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { SKILLS_STATE_EVENT_TYPE } from '../services/matrix-service';

import type MatrixService from '../services/matrix-service';

export default class AddSkillsToRoomCommand extends HostBaseCommand<
  BaseCommandModule.AddSkillsToRoomInput,
  undefined
> {
  @service private declare matrixService: MatrixService;

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
      SKILLS_STATE_EVENT_TYPE,
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
