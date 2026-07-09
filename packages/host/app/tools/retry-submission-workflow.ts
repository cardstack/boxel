import { service } from '@ember/service';

import { isCardInstance, rri } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import SendBotTriggerEventTool from './bot-requests/send-bot-trigger-event';

import type RealmService from '../services/realm';
import type StoreService from '../services/store';

// Local view of the boxel-catalog SubmissionWorkflowCard — that repo isn't cloned in boxel CI. (CS-11166)
interface WorkflowCardView {
  roomId?: string;
  listing?: { id?: string };
  failedStep?: string | null;
}

// Re-emits the `pr-listing-retry` bot trigger event for an existing
// SubmissionWorkflowCard that ended in a failed state. Reads roomId + listing
// off the card so the same Matrix room is reused (preserving the prior
// conversation and the bot-runner's view of the workflow).
export default class RetrySubmissionWorkflowTool extends HostBaseTool<
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

    let result = await this.store.get(workflowCardId);
    if (!result || !isCardInstance(result)) {
      throw new Error(
        `Cannot retry: workflow card ${workflowCardId} not found`,
      );
    }
    let workflowCard = result as unknown as WorkflowCardView;

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

    // Snapshot the prior failedStep so we can restore it if the send fails
    // — without it, the optimistic clear below would hide the Retry button
    // (canRetry requires prCreationError || failedStep) and strand the user.
    let priorFailedStep = workflowCard.failedStep ?? null;

    // Optimistic clear for instant UI feedback. Re-set on send failure.
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

    try {
      await new SendBotTriggerEventTool(this.commandContext).execute({
        roomId,
        realm: listingRealm,
        type: 'pr-listing-retry',
        input: {
          workflowCardUrl: workflowCardId,
          workflowCardRealm:
            this.realm.realmOf(rri(workflowCardId)) ?? undefined,
        },
      });
    } catch (sendError: any) {
      let message =
        sendError instanceof Error ? sendError.message : String(sendError);
      await this.store.patch(
        workflowCardId,
        {
          attributes: {
            prCreationError: `Failed to send retry: ${message}`,
            failedStep: priorFailedStep,
          },
        },
        { doNotWaitForPersist: true },
      );
      throw sendError;
    }
  }
}
