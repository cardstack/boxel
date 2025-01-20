import { service } from '@ember/service';

import { APP_BOXEL_ROOM_SKILLS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class UpdateSkillActivationCommand extends HostBaseCommand<
  typeof BaseCommandModule.UpdateSkillActivationInput
> {
  @service private declare matrixService: MatrixService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { UpdateSkillActivationInput } = commandModule;
    return UpdateSkillActivationInput;
  }

  protected async run(
    input: BaseCommandModule.UpdateSkillActivationInput,
  ): Promise<undefined> {
    let { matrixService } = this;
    let { roomId, skillEventId, isActive } = input;
    await matrixService.updateStateEvent(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      '',
      async (currentSkillsConfig) => {
        let newSkillsConfig = {
          enabledEventIds: [...(currentSkillsConfig.enabledEventIds || [])],
          disabledEventIds: [...(currentSkillsConfig.disabledEventIds || [])],
        };
        if (isActive) {
          newSkillsConfig.enabledEventIds.push(skillEventId);
          newSkillsConfig.disabledEventIds =
            newSkillsConfig.disabledEventIds.filter(
              (id) => id !== skillEventId,
            );
        } else {
          newSkillsConfig.disabledEventIds.push(skillEventId);
          newSkillsConfig.enabledEventIds =
            newSkillsConfig.enabledEventIds.filter((id) => id !== skillEventId);
        }
        return newSkillsConfig;
      },
    );
  }
}
