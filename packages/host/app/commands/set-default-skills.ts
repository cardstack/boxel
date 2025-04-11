import { service } from '@ember/service';

import type { DefaultSkills } from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class SetDefaultSkillsCommand extends HostBaseCommand<
  typeof DefaultSkills,
  undefined
> {
  @service declare private matrixService: MatrixService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { DefaultSkills } = commandModule;
    return DefaultSkills;
  }

  protected async run(input: DefaultSkills): Promise<undefined> {
    if (input.submode !== 'interact' && input.submode !== 'code') {
      throw new Error(`Invalid submode: ${input.submode}`);
    }
    await this.matrixService.setDefaultSkillIDs(input.submode, input.skillIds);
    return undefined;
  }
}
