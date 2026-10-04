import { logger } from '@cardstack/runtime-common';
import {
  APP_BOXEL_TOOL_RESULT_REL_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';
import type { MatrixClient } from 'matrix-js-sdk';
import type { ChatCompletionMessageToolCall } from 'openai/resources';
import {
  executeReadUrl,
  READ_URL_MAX_CALLS_PER_RESPONSE,
  urlFromReadUrlArguments,
  type ReadUrlOptions,
  type ReadUrlResult,
} from './read-url.ts';
import {
  publishToolResult,
  uploadToMatrix,
} from './read-realm-file-fulfillment.ts';

let log = logger('ai-bot:read-url');

// A page or text file is attached as plain text, so the prompt builder
// downloads and inlines it into the tool message like any other text file.
const READ_URL_TEXT_CONTENT_TYPE = 'text/plain';

export interface ReadUrlFulfillmentDeps {
  client: MatrixClient;
  roomId: string;
  // The bot message that carried the readUrl requests; results relate back
  // to it.
  requestEventId: string;
  agentId: string | undefined;
  readOptions: ReadUrlOptions;
  // Why a call's URL must not be read at all, if it must not.
  refusal?: (url: string) => string | undefined;
  // Injectable for tests.
  read?: (url: string, options: ReadUrlOptions) => Promise<ReadUrlResult>;
  upload?: (
    content: string | Uint8Array,
    contentType: string,
  ) => Promise<string>;
}

export interface ReadUrlFulfillmentOutcome {
  commandRequestId: string;
  ok: boolean;
  error?: string;
}

// Runs each readUrl call ai-bot owns and publishes its outcome as a
// tool-result event. A read page or text file is uploaded to Matrix and
// attached as text, so its content is inlined into the tool message; a read
// image (or other media) is uploaded under its own content type and
// attached as media, so the prompt embeds it for the model on the turn the
// result starts. A failed read publishes the reason instead, and calls past
// READ_URL_MAX_CALLS_PER_RESPONSE are answered without a read. Calls are
// handled one at a time: each published result re-triggers the bot, and
// publishing in sequence keeps every earlier result on the server before the
// handler a later one triggers reads the room history.
export async function fulfillReadUrlCalls(
  calls: ChatCompletionMessageToolCall[],
  deps: ReadUrlFulfillmentDeps,
): Promise<ReadUrlFulfillmentOutcome[]> {
  let outcomes: ReadUrlFulfillmentOutcome[] = [];
  let read = 0;
  for (let call of calls) {
    if (call.type !== 'function') {
      continue;
    }
    // Calls past the cap still get a result, so the turn settles and the
    // model learns which reads to ask for again.
    if (read >= READ_URL_MAX_CALLS_PER_RESPONSE) {
      let url = urlFromReadUrlArguments(call.function.arguments);
      outcomes.push(
        await publishFailure(
          call.id,
          `${url ?? 'This URL'} was not read: one response reads at most ${READ_URL_MAX_CALLS_PER_RESPONSE} URLs. Read it on a later turn if you still need it.`,
          deps,
        ),
      );
      continue;
    }
    read++;
    outcomes.push(await fulfillOne(call, deps));
  }
  return outcomes;
}

async function fulfillOne(
  call: ChatCompletionMessageToolCall & { type: 'function' },
  deps: ReadUrlFulfillmentDeps,
): Promise<ReadUrlFulfillmentOutcome> {
  let url = urlFromReadUrlArguments(call.function.arguments);
  if (!url) {
    return await publishFailure(call.id, 'readUrl needs a url.', deps);
  }
  let refusal = deps.refusal?.(url);
  if (refusal) {
    return await publishFailure(call.id, refusal, deps);
  }
  let read = deps.read ?? executeReadUrl;
  let upload =
    deps.upload ??
    ((content: string | Uint8Array, contentType: string) =>
      uploadToMatrix(deps.client, content, contentType));

  let result = await read(url, deps.readOptions);
  if (!result.ok) {
    return await publishFailure(call.id, result.error, deps);
  }
  let contentType =
    result.kind === 'text' ? READ_URL_TEXT_CONTENT_TYPE : result.contentType;
  let body = result.kind === 'text' ? result.content : result.bytes;
  let uploadedUrl: string;
  try {
    uploadedUrl = await upload(body, contentType);
  } catch (e: any) {
    log.error(`readUrl: upload failed for ${url}: ${e?.message ?? e}`);
    return await publishFailure(
      call.id,
      `${url} was read but could not be stored for you to see.`,
      deps,
    );
  }
  await publishToolResult(
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
      data: {
        context: { agentId: deps.agentId },
        attachedFiles: [
          {
            sourceUrl: result.finalUrl,
            url: uploadedUrl,
            name: result.name,
            contentType,
            contentSize:
              typeof body === 'string'
                ? Buffer.byteLength(body)
                : body.byteLength,
          },
        ],
      },
    },
    'readUrl',
  );
  return { commandRequestId: call.id, ok: true };
}

async function publishFailure(
  commandRequestId: string,
  error: string,
  deps: ReadUrlFulfillmentDeps,
): Promise<ReadUrlFulfillmentOutcome> {
  await publishToolResult(
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
    'readUrl',
  );
  return { commandRequestId, ok: false, error };
}
