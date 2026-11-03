import {
  APP_BOXEL_TOOL_RESULT_REL_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';
import type { SerializedFileDef } from '@cardstack/base/file-api';
import { publishToolResult } from '../results.ts';
import type { BotToolCall, BotToolTarget } from '../types.ts';
import {
  lookUpAttachment,
  selectViewAttachmentUrls,
  VIEW_ATTACHMENT_MAX_URLS,
  VIEW_ATTACHMENT_TOOL_NAME,
  type RoomAttachments,
} from './view.ts';

export interface ViewAttachmentFulfillmentDeps extends BotToolTarget {
  // The files humans attached to their messages in the room (see
  // roomAttachments), the only files a call can view.
  attachments: RoomAttachments;
  // The active model's input modalities (see activeModelInputModalities),
  // when it names them.
  inputModalities?: string[];
}

export interface ViewAttachmentFulfillmentOutcome {
  commandRequestId: string;
  // True only when every named file was attached to the result.
  ok: boolean;
  error?: string;
  // Whether the call's result reached the room.
  published: boolean;
}

// Runs one viewAttachment call and publishes its result. Each file the call
// names that a user attached in the room is attached to the result as the
// same stored file (data.attachedFiles), which the prompt builder embeds on
// the next request as tool-result media. The result is `applied` while at
// least one file was found, with the files that weren't named in
// failureReason, and `invalid` when none was. Never throws: a publish failure
// is logged so the turn still settles.
export async function fulfillViewAttachmentCall(
  call: BotToolCall,
  deps: ViewAttachmentFulfillmentDeps,
): Promise<ViewAttachmentFulfillmentOutcome> {
  let { urls, dropped } = selectViewAttachmentUrls(call.function.arguments);
  if (urls.length === 0) {
    return await publishFailure(
      call.id,
      `${VIEW_ATTACHMENT_TOOL_NAME} needs a non-empty list of urls.`,
      deps,
    );
  }

  let attachedFiles: SerializedFileDef[] = [];
  let errors: string[] = [];
  for (let url of urls) {
    let lookup = lookUpAttachment(url, deps.attachments, deps.inputModalities);
    if (lookup.ok) {
      attachedFiles.push(lookup.file);
    } else {
      errors.push(lookup.error);
    }
  }
  if (dropped.length > 0) {
    errors.push(
      `${dropped.length} of the ${urls.length + dropped.length} urls in this call were not viewed: ${VIEW_ATTACHMENT_TOOL_NAME} views at most ${VIEW_ATTACHMENT_MAX_URLS} files per call. Request these on a later turn if you still need them:\n${dropped.join('\n')}`,
    );
  }
  let failureReason = errors.join('\n') || undefined;

  if (attachedFiles.length === 0) {
    return await publishFailure(call.id, failureReason!, deps);
  }

  let published = await publishToolResult(
    deps.client,
    deps.roomId,
    {
      msgtype: APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
      commandRequestId: call.id,
      'm.relates_to': {
        rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
        key: 'applied',
        event_id: deps.requestEventId,
      },
      ...(failureReason ? { failureReason } : {}),
      data: { context: { agentId: deps.agentId }, attachedFiles },
    },
    VIEW_ATTACHMENT_TOOL_NAME,
  );
  return {
    commandRequestId: call.id,
    ok: errors.length === 0,
    ...(failureReason ? { error: failureReason } : {}),
    published,
  };
}

async function publishFailure(
  commandRequestId: string,
  error: string,
  deps: ViewAttachmentFulfillmentDeps,
): Promise<ViewAttachmentFulfillmentOutcome> {
  let published = await publishToolResult(
    deps.client,
    deps.roomId,
    {
      msgtype: APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
      commandRequestId,
      failureReason: error,
      'm.relates_to': {
        rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
        key: 'invalid',
        event_id: deps.requestEventId,
      },
      data: { context: { agentId: deps.agentId } },
    },
    VIEW_ATTACHMENT_TOOL_NAME,
  );
  return { commandRequestId, ok: false, error, published };
}
