import { service } from '@ember/service';

import type { AiSettingsCard } from 'https://cardstack.com/base/ai-settings-card';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class SetAiSettingsCommand extends HostBaseCommand<
  typeof AiSettingsCard,
  undefined
> {
  @service declare private matrixService: MatrixService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { AiSettingsCard } = commandModule;
    return AiSettingsCard;
  }

  protected async run(input: AiSettingsCard): Promise<undefined> {
    await this.matrixService.setAiSettings(input);
  }
}
