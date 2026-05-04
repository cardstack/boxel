import { service } from '@ember/service';

import { isCardInstance, rri } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import SendBotTriggerEventCommand from './bot-requests/send-bot-trigger-event';

import type RealmService from '../services/realm';
import type StoreService from '../services/store';
import type { SubmissionWorkflowCard } from '@cardstack/catalog/submission-workflow-card/submission-workflow-card';

// Re-emits the `pr-listing-retry` bot trigger event for an existing
// SubmissionWorkflowCard that ended in a failed state. Reads roomId + listing
// off the card so the same Matrix room is reused (preserving the prior
// conversation and the bot-runner's view of the workflow).
export default class RetrySubmissionWorkflowCommand extends HostBaseCommand<
  typeof BaseCommandModule.RetrySubmissionWorkflowInput
> {
  @service declare private store: StoreService;
  @service declare private realm: RealmService;

  description =
    'Retry a failed submission workflow by re-emitting the bot trigger event into the original room.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { RetrySubmissionWorkflowInput } = commandModule;
    return RetrySubmissionWorkflowInput;
  }

  requireInputFields = ['workflowCardId'];

  protected async run(
    input: BaseCommandModule.RetrySubmissionWorkflowInput,
  ): Promise<undefined> {
    let { workflowCardId } = input;

    let workflowCard =
      await this.store.get<SubmissionWorkflowCard>(workflowCardId);
    if (!workflowCard || !isCardInstance(workflowCard)) {
      throw new Error(
        `Cannot retry: workflow card ${workflowCardId} not found`,
      );
    }

    let roomId = workflowCard.roomId;
    let listingId = workflowCard.listing?.id;
    if (!roomId) {
      throw new Error(
        'Cannot retry: workflow card has no roomId — only newer submissions support retry',
      );
    }
    if (!listingId) {
      throw new Error('Cannot retry: workflow card has no linked listing');
    }

    let listingRealm = this.realm.realmOf(rri(listingId));
    if (!listingRealm) {
      throw new Error(
        `Cannot retry: cannot determine realm for listing ${listingId}`,
      );
    }

    // Clear the prior failure state up front for instant UI feedback. The
    // bot-runner will repopulate these fields on success or on a fresh
    // failure; we don't have to wait for it to do so.
    await this.store.patch(
      workflowCardId,
      {
        attributes: {
          prCreationError: null,
          failedStep: null,
        },
      },
      { doNotWaitForPersist: true },
    );

    await new SendBotTriggerEventCommand(this.commandContext).execute({
      roomId,
      realm: listingRealm,
      type: 'pr-listing-retry',
      input: {
        workflowCardUrl: workflowCardId,
      },
    });
  }
}
