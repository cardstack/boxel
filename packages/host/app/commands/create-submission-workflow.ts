import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import UseAiAssistantCommand from './ai-assistant';
import OpenInInteractModeCommand from './open-in-interact-mode';
import SendBotTriggerEventCommand from './bot-requests/send-bot-trigger-event';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';
import type { Listing } from '@cardstack/catalog/listing/listing';

export default class CreateSubmissionWorkflowCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateListingPRRequestInput
> {
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  description =
    'Create a submission workflow card for a catalog listing, open it in interact mode, and trigger the PR creation process.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateListingPRRequestInput } = commandModule;
    return CreateListingPRRequestInput;
  }

  requireInputFields = ['realm', 'listingId'];

  get submissionsRealm(): string | undefined {
    return this.realmServer.catalogRealmURLs.find((realm) =>
      realm.endsWith('/submissions/'),
    );
  }

  protected async run(
    input: BaseCommandModule.CreateListingPRRequestInput,
  ): Promise<undefined> {
    await this.matrixService.ready;

    let { realm, listingId } = input;
    let listingName: string | undefined;
    let listingSummary: string | undefined;
    let listing = await this.store.get<Listing>(listingId);
    if (listing && isCardInstance(listing)) {
      listingName = listing.name ?? listing.id;
      listingSummary = listing.summary ?? undefined;
    }

    let submittedBy = this.matrixService.userId ?? undefined;

    // Save the workflow card in the user's realm (where the listing lives)
    let workflowRealm =
      this.realm.realmOfURL(new URL(listingId))?.href ?? realm;

    // Step 1: Create the SubmissionWorkflowCard with listing linked
    let workflowDoc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes: {
          title: `Submit ${listingName ?? 'Listing'}`,
          submittedBy: submittedBy ?? null,
          submissionStatus: 'preparing-submission',
        },
        relationships: {
          listing: {
            links: {
              self: listingId,
            },
          },
          prCard: {
            links: {
              self: null,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${this.catalogRealm}submission-workflow-card`,
            name: 'SubmissionWorkflowCard',
          },
        },
      },
    };

    let workflowCard = await this.store.add(workflowDoc, {
      realm: workflowRealm,
    });

    if (!isCardInstance(workflowCard)) {
      throw new Error('Failed to create submission workflow card');
    }

    let workflowCardId = workflowCard.id;
    if (!workflowCardId) {
      throw new Error(
        'Submission workflow card was created but has no ID',
      );
    }

    // Step 2: Open the workflow card in interact mode immediately
    await new OpenInInteractModeCommand(this.commandContext).execute({
      cardId: workflowCardId,
    });

    // Step 3: Create Matrix room and send bot trigger for async PR creation
    let useAiAssistantCommand = new UseAiAssistantCommand(this.commandContext);
    let createRoomResult = await useAiAssistantCommand.execute({
      roomId: 'new',
      roomName: `PR: ${listingName ?? listingId ?? 'Listing'}`,
      openRoom: false,
    });
    let roomId = createRoomResult.roomId;

    let submissionBotId = this.matrixService.submissionBotUserId;
    if (!(await this.matrixService.isUserInRoom(roomId, submissionBotId))) {
      await this.matrixService.inviteUserToRoom(roomId, submissionBotId);
    }

    await new SendBotTriggerEventCommand(this.commandContext).execute({
      roomId,
      realm,
      type: 'pr-listing-create',
      input: {
        roomId,
        realm,
        listingId,
        workflowCardUrl: workflowCardId,
        ...(listingName ? { listingName } : {}),
        ...(listingSummary ? { listingSummary } : {}),
        ...(submittedBy ? { submittedBy } : {}),
      },
    });
  }

  private get catalogRealm(): string | undefined {
    return this.realmServer.catalogRealmURLs.find((realm) =>
      realm.endsWith('/catalog/'),
    );
  }
}
