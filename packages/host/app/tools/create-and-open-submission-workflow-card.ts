import HostBaseTool from '../lib/host-base-tool';

import CreateSubmissionWorkflowTool from './create-submission-workflow';

import type * as BaseToolModule from '@cardstack/base/command';

export default class CreateAndOpenSubmissionWorkflowCardTool extends HostBaseTool<
  typeof BaseToolModule.CreateListingPRRequestInput
> {
  description =
    'Create a submission workflow card and open it in interact mode to track PR creation.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CreateListingPRRequestInput } = commandModule;
    return CreateListingPRRequestInput;
  }

  requireInputFields = ['realm', 'listingId'];

  protected async run(
    input: BaseToolModule.CreateListingPRRequestInput,
  ): Promise<undefined> {
    await new CreateSubmissionWorkflowTool(this.commandContext).execute({
      realm: input.realm,
      listingId: input.listingId,
      listingName: input.listingName,
    });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { CreateAndOpenSubmissionWorkflowCardTool as CreateAndOpenSubmissionWorkflowCardCommand };
