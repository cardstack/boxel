import { service } from '@ember/service';

import { isCardInstance, logger } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../../lib/host-base-command';

import UseAiAssistantCommand from '../ai-assistant';

import SendBotTriggerEventCommand from './send-bot-trigger-event';

import type MatrixService from '../services/matrix-service';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';
import type { Listing } from '@cardstack/catalog/listing/listing';

const log = logger('commands:create-listing-pr-request');

export default class CreateListingPRRequestCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateListingPRRequestInput
> {
  @service declare private matrixService: MatrixService;
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;

  description =
    'Request a GitHub PR from a catalog listing and notify the bot runner.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateListingPRRequestInput } = commandModule;
    return CreateListingPRRequestInput;
  }

  requireInputFields = ['realm', 'listingId'];

  protected async run(
    input: BaseCommandModule.CreateListingPRRequestInput,
  ): Promise<undefined> {
    await this.matrixService.ready;

    let { realm, listingId } = input;
    let listingName: string | undefined;
    let listing = await this.store.get<Listing>(listingId);
    if (listing && isCardInstance(listing)) {
      listingName = listing.name ?? listing.id;
    }

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

    await this.registerPRWebhook();

    await new SendBotTriggerEventCommand(this.commandContext).execute({
      roomId,
      realm,
      type: 'pr-listing-create',
      input: {
        roomId,
        realm,
        listingId,
        ...(listingName ? { listingName } : {}),
      },
    });
  }

  private async registerPRWebhook(): Promise<void> {
    try {
      // TODO: Avoid the list+find round-trip by storing the webhook ID (output
      // by register-github-webhook script) as a realm config or env var so the
      // command can fetch the GitHub webhook directly by ID.
      const webhooks = await this.realmServer.listIncomingWebhooks();
      const githubWebhook = webhooks.find(
        (w: { verificationType: string }) =>
          w.verificationType === 'HMAC_SHA256_HEADER',
      );

      if (!githubWebhook) {
        log.warn(
          'No GitHub incoming webhook found. Run the register-github-webhook script first to set up the shared webhook for this environment.',
        );
        return;
      }

      let catalogRealmURL = this.realmServer.catalogRealmURLs[0];
      if (!catalogRealmURL) {
        log.warn(
          'No catalog realm URL found, skipping webhook command registration.',
        );
        return;
      }

      await this.realmServer.createWebhookCommand({
        incomingWebhookId: githubWebhook.id,
        command: `${catalogRealmURL}commands/process-github-event/default`,
        filter: {
          submissionRealmUrl: this.realmServer.submissionRealmURL,
        },
      });

      log.debug('Registered webhook commands for room:', {
        webhookUrl: `${this.realmServer.url.href}_webhooks/${githubWebhook.webhookPath}`,
      });
    } catch (error: any) {
      log.error('Failed to register PR webhook:', error);
      // Don't fail the PR request if webhook registration fails
    }
  }
}
