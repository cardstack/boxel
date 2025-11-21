import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

export default class CheckCorrectnessCommand extends HostBaseCommand<
  typeof BaseCommandModule.CheckCorrectnessInput,
  typeof BaseCommandModule.CorrectnessResultCard
> {
  description =
    'Run post-change correctness checks for a specific file or card instance.';
  static actionVerb = 'Check';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    return commandModule.CheckCorrectnessInput;
  }

  requireInputFields = ['targetType', 'targetRef'];

  protected async run(
    input: BaseCommandModule.CheckCorrectnessInput,
  ): Promise<BaseCommandModule.CorrectnessResultCard> {
    if (!input.targetType || !input.targetRef) {
      throw new Error(
        'Target type and reference are required to run correctness checks.',
      );
    }

    // Placeholder implementation. Future work will execute real checks and
    // include any discovered issues in the returned payload.
    let commandModule = await this.loadCommandModule();
    const { CorrectnessResultCard } = commandModule;
    return new CorrectnessResultCard({
      correct: true,
      errors: [],
      warnings: [],
    });
  }
}
