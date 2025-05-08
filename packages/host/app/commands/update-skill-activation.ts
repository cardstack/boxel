import { service } from '@ember/service';

import { APP_BOXEL_ROOM_SKILLS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { SerializedFile } from 'https://cardstack.com/base/file-api';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class UpdateSkillActivationCommand extends HostBaseCommand<
  typeof BaseCommandModule.UpdateSkillActivationInput
> {
  @service declare private matrixService: MatrixService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { UpdateSkillActivationInput } = commandModule;
    return UpdateSkillActivationInput;
  }

  protected async run(
    input: BaseCommandModule.UpdateSkillActivationInput,
  ): Promise<undefined> {
    let { matrixService } = this;
    let { roomId, skillCardId, isActive } = input;
    await matrixService.updateStateEvent(
      roomId,
      APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      '',
      async (currentSkillsConfig: Record<string, any>) => {
        let newSkillsConfig = {
          ...currentSkillsConfig,
        };

        let skillFileDef = [
          ...(newSkillsConfig.enabledSkillCards || []),
          ...(newSkillsConfig.disabledSkillCards || []),
        ].find((fileDef: SerializedFile) => fileDef.sourceUrl === skillCardId);

        if (!skillFileDef) {
          return newSkillsConfig;
        }

        if (isActive) {
          newSkillsConfig.enabledSkillCards.push(skillFileDef);
        } else {
          newSkillsConfig.disabledSkillCards.push(skillFileDef);
          newSkillsConfig.enabledSkillCards =
            newSkillsConfig.enabledSkillCards.filter(
              (fileDef: SerializedFile) => fileDef.sourceUrl !== skillCardId,
            );
        }
        return newSkillsConfig as Record<string, any>;
      },
    );
  }
}
