import { service } from '@ember/service';

import { isCardInstance, rri, toBranchName } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import type { Listing } from '@cardstack/runtime-common';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import UseAiAssistantTool from './ai-assistant';
import SendBotTriggerEventTool from './bot-requests/send-bot-trigger-event';
import OpenInInteractModeTool from './open-in-interact-mode';

import type MatrixService from '../services/matrix-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

export default class CreateSubmissionWorkflowTool extends HostBaseTool<
  typeof BaseToolModule.CreateListingPRRequestInput
> {
  @service declare private matrixService: MatrixService;
  @service declare private store: StoreService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  description =
    'Create a submission workflow card for a catalog listing, open it in interact mode, and trigger the PR creation process.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CreateListingPRRequestInput } = commandModule;
    return CreateListingPRRequestInput;
  }

  requireInputFields = ['realm', 'listingId'];

  get submissionsRealm(): string | undefined {
    return this.realmServer.catalogRealmIdentifiers.find((realm) =>
      realm.endsWith('/submissions/'),
    );
  }

  protected async run(
    input: BaseToolModule.CreateListingPRRequestInput,
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
    let workflowRealm = this.realm.realmOf(rri(listingId)) ?? realm;

    let catalogRealm = this.catalogRealm;
    if (!catalogRealm) {
      throw new Error(
        'Cannot create submission workflow: catalog realm URL not found',
      );
    }

    // Create the Matrix room first so its id can be persisted on the workflow
    // card — the retry flow reads roomId off the card to re-emit the bot
    // trigger event without losing the original conversation.
    let useAiAssistantCommand = new UseAiAssistantTool(this.commandContext);
    let createRoomResult = await useAiAssistantCommand.execute({
      roomId: 'new',
      roomName: `PR: ${listingName ?? listingId ?? 'Listing'}`,
      openRoom: false,
    });
    let roomId = createRoomResult.roomId;

    // Branch name is generated once and persisted on the workflow card so
    // retries reuse the same GitHub branch.
    let branchName = toBranchName(listingName ?? 'UntitledListing');

    // Cleanup window covers everything between "room exists" and "workflow
    // card persisted with roomId baked in". Once the card exists, leaving
    // the room would orphan the card's roomId reference, so cleanup stops.
    let workflowCardId: string;
    try {
      let submissionBotId = this.matrixService.submissionBotUserId;
      if (!(await this.matrixService.isUserInRoom(roomId, submissionBotId))) {
        await this.matrixService.inviteUserToRoom(roomId, submissionBotId);
      }

      let workflowDoc: LooseSingleCardDocument = {
        data: {
          type: 'card',
          attributes: {
            title: `Submit ${listingName ?? 'Listing'}`,
            submittedBy: submittedBy ?? null,
            catalogRealmUrl: catalogRealm,
            roomId,
            branchName,
          },
          relationships: {
            listing: { links: { self: listingId } },
            prCard: { links: { self: null } },
          },
          meta: {
            adoptsFrom: {
              module: rri(
                `${catalogRealm}submission-workflow-card/submission-workflow-card`,
              ),
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
      if (!workflowCard.id) {
        throw new Error('Submission workflow card was created but has no ID');
      }
      workflowCardId = workflowCard.id;
    } catch (err) {
      try {
        await this.matrixService.leave(roomId);
        await this.matrixService.forget(roomId);
      } catch (cleanupError) {
        console.warn(
          `create-submission-workflow: failed to clean up orphaned room ${roomId}`,
          cleanupError,
        );
      }
      throw err;
    }

    await new OpenInInteractModeTool(this.commandContext).execute({
      cardId: workflowCardId,
    });

    await new SendBotTriggerEventTool(this.commandContext).execute({
      roomId,
      realm,
      type: 'pr-listing-create',
      input: {
        roomId,
        realm,
        listingId,
        workflowCardUrl: workflowCardId,
        workflowCardRealm: workflowRealm,
        branchName,
        ...(listingName ? { listingName } : {}),
        ...(listingSummary ? { listingSummary } : {}),
        ...(submittedBy ? { submittedBy } : {}),
      },
    });
  }

  private get catalogRealm(): string | undefined {
    return this.realmServer.catalogRealmIdentifiers.find((realm) =>
      realm.endsWith('/catalog/'),
    );
  }
}
