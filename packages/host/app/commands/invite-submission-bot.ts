import { service } from '@ember/service';

import format from 'date-fns/format';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';

// Room state event type for submission context
const SUBMISSION_CONTEXT_EVENT_TYPE = 'com.cardstack.submission_context';

export default class InviteSubmissionBotCommand extends HostBaseCommand<
  typeof BaseCommandModule.InviteSubmissionBotInput
> {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  static actionVerb = 'Submit';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { InviteSubmissionBotInput } = commandModule;
    return InviteSubmissionBotInput;
  }

  requireInputFields = ['submissionTarget'];

  protected async run(
    input: BaseCommandModule.InviteSubmissionBotInput,
  ): Promise<undefined> {
    const { matrixService, operatorModeStateService } = this;
    const { submissionTarget, submissionType, autoStart, metadata } = input;

    if (!submissionTarget) {
      throw new Error('submissionTarget is required');
    }

    const submissionBotId = matrixService.submissionBotUserId;
    const userId = matrixService.userId;

    if (!userId) {
      throw new Error('User must be logged in to submit for review');
    }

    // Always create a new room for the submission
    const roomName = `Submission: ${submissionType || 'review'} - ${format(new Date(), 'yyyy-MM-dd HH:mm')}`;

    const roomResult = await matrixService.createRoom({
      preset: matrixService.privateChatPreset,
      invite: [submissionBotId],
      name: roomName,
      room_alias_name: encodeURIComponent(
        `submission-${format(new Date(), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx")}-${userId}`,
      ),
      power_level_content_override: {
        users: {
          [userId]: 100,
          [submissionBotId]: 50,
        },
      },
    });

    const roomId = roomResult.room_id;

    // Store submission context in room state
    // This allows the submission bot to read context when it joins
    await matrixService.sendStateEvent(
      roomId,
      SUBMISSION_CONTEXT_EVENT_TYPE,
      {
        target: submissionTarget,
        type: submissionType || 'other',
        autoStart: autoStart ?? false,
        metadata: metadata || {},
        invitedAt: new Date().toISOString(),
        invitedBy: userId,
      },
      '', // empty state key
    );

    // Open the AI assistant panel with the new room
    operatorModeStateService.openAiAssistant();
    matrixService.currentRoomId = roomId;

    return undefined;
  }
}
