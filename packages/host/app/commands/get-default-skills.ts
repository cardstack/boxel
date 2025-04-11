import { service } from '@ember/service';

import type {
  BoxelUISubmode,
  DefaultSkills,
} from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class GetDefaultSkillsCommand extends HostBaseCommand<
  typeof BoxelUISubmode,
  typeof DefaultSkills
> {
  @service declare private matrixService: MatrixService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { BoxelUISubmode } = commandModule;
    return BoxelUISubmode;
  }

  protected async run(input: BoxelUISubmode): Promise<DefaultSkills> {
    let commandModule = await this.loadCommandModule();
    const { DefaultSkills } = commandModule;
    if (input.submode !== 'interact' && input.submode !== 'code') {
      throw new Error(`Invalid submode: ${input.submode}`);
    }
    return new DefaultSkills({
      submode: input.submode,
      skillIds: await this.matrixService.getDefaultSkillIDs(input.submode),
    });
  }
}
