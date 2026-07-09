import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import CreateSubmissionWorkflowTool from './create-submission-workflow';

export default class CreateAndOpenSubmissionWorkflowCardTool extends HostBaseTool<
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
    await new CreateSubmissionWorkflowTool(this.commandContext).execute({
      realm: input.realm,
      listingId: input.listingId,
      listingName: input.listingName,
    });
  }
}
