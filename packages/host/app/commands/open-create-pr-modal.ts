import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import CreateSubmissionWorkflowCommand from './create-submission-workflow';

export default class OpenCreatePRModalCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateListingPRRequestInput
> {
  description =
    'Create a submission workflow card and open it in interact mode to track PR creation.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateListingPRRequestInput } = commandModule;
    return CreateListingPRRequestInput;
  }

  requireInputFields = ['realm', 'listingId'];

  protected async run(
    input: BaseCommandModule.CreateListingPRRequestInput,
  ): Promise<undefined> {
    await new CreateSubmissionWorkflowCommand(this.commandContext).execute({
      realm: input.realm,
      listingId: input.listingId,
      listingName: input.listingName,
    });
  }
}
