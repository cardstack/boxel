import { activeModelInputModalities } from '@cardstack/runtime-common/ai';
import type { BotTool } from '../types.ts';
import { fulfillViewAttachmentCall } from './fulfillment.ts';
import {
  roomAttachments,
  VIEW_ATTACHMENT_TOOL_NAME,
  viewAttachmentLabel,
  viewAttachmentTool,
} from './view.ts';

// viewAttachment: brings a media file a user attached in the room back into
// the current turn (see view.ts).
export const viewAttachmentBotTool: BotTool = {
  name: VIEW_ATTACHMENT_TOOL_NAME,
  definition: viewAttachmentTool,

  // It shows only what the room's own messages attached, on nobody's realm
  // permissions, so it needs no delegation; but the bot starts the
  // continuation from its own result only when it can attribute that result
  // to the room's one human.
  isOffered(room) {
    return room.humanMemberCount === 1;
  },

  label(argumentsJson) {
    return viewAttachmentLabel(argumentsJson);
  },

  async startTurn(room) {
    let attachments = roomAttachments(room.history, room.aiBotUserId);
    let inputModalities = activeModelInputModalities(room.history);
    return {
      needsApproval() {
        return false;
      },
      async fulfill(call, target) {
        let { commandRequestId, published } = await fulfillViewAttachmentCall(
          call,
          { ...target, attachments, inputModalities },
        );
        return { commandRequestId, published };
      },
    };
  },
};
