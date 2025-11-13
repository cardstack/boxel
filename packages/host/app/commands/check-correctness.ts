import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

export default class CheckCorrectnessCommand extends HostBaseCommand<
  typeof BaseCommandModule.CheckCorrectnessInput
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
  ): Promise<undefined> {
    if (!input.targetType || !input.targetRef) {
      throw new Error(
        'Target type and reference are required to run correctness checks.',
      );
    }

    // This command is intentionally light-weight for now. In the future we
    // will trigger automated verification (tests, linting, etc.) from here.
    debugger;
    return undefined;
  }
}
