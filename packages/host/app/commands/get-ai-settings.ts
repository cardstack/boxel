import { service } from '@ember/service';

import type { AiSettingsCard } from 'https://cardstack.com/base/ai-settings-card';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class GetAiSettingsCommand extends HostBaseCommand<
  undefined,
  typeof AiSettingsCard
> {
  @service declare private matrixService: MatrixService;

  protected async run(): Promise<AiSettingsCard> {
    return await this.matrixService.getAiSettings();
  }
}
