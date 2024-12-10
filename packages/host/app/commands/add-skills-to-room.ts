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
    let { client } = this.matrixService;
    let { roomId, skills } = input;
    let roomSkillEventIds = await this.matrixService.addCardsToRoom(
      skills,
      roomId,
      this.matrixService.skillCardHashes,
      { includeComputeds: true, maybeRelativeURL: null },
    );
    let skillEventIdsStateEvent: Record<string, any> = {};
    try {
      skillEventIdsStateEvent = await client.getStateEvent(
        roomId,
        SKILLS_STATE_EVENT_TYPE,
        '',
      );
    } catch (e: unknown) {
      if (e instanceof Error && 'errcode' in e && e.errcode === 'M_NOT_FOUND') {
        // this is fine, it just means the state event doesn't exist yet
      } else {
        throw e;
      }
    }
    let roomData = this.matrixService.ensureRoomData(roomId);
    await roomData.mutex.dispatch(async () => {
      client.sendStateEvent(roomId, SKILLS_STATE_EVENT_TYPE, {
        enabledEventIds: [
          ...new Set([
            ...(skillEventIdsStateEvent?.enabledEventIds || []),
            ...roomSkillEventIds,
          ]),
        ],
        disabledEventIds: [
          ...(skillEventIdsStateEvent?.disabledEventIds || []),
        ],
      });
    });
  }
}
