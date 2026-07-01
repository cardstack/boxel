import { createHash } from 'crypto';
import { logger } from '@cardstack/runtime-common';
import { sendMatrixEvent } from '@cardstack/runtime-common/ai';
import {
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';
import type { MatrixClient } from 'matrix-js-sdk';
import type { ChatCompletionMessageToolCall } from 'openai/resources';
import {
  executeReadRealmFile,
  fileLabelFromUrl,
  type ReadRealmFileArgs,
} from './read-realm-file.ts';
import type { DelegatedUserRealmSessionManager } from './user-delegated-realm-server-session.ts';

let log = logger('ai-bot:read-realm-file');

// The contentType the fetched file is attached under. It must be text-based so
// the prompt builder downloads and inlines the content (rather than treating it
// as opaque media); 'text/plain' satisfies that for any source we read.
const READ_FILE_CONTENT_TYPE = 'text/plain';

// Maps a fetched file's content hash to the Matrix media URL it was uploaded
// under, so identical bytes (the same skill read across rooms or turns) are
// uploaded once and re-referenced. Keyed on a SHA-256 of the content, so a
// changed file misses the cache and re-uploads — dedup without staleness.
// Matrix media is not content-addressable (each upload gets a fresh id), so
// this app-level cache is what keeps us from re-storing the same bytes.
const uploadedContentUrlByHash = new Map<string, string>();

export interface ReadRealmFileFulfillmentDeps {
  client: MatrixClient;
  roomId: string;
  // The bot message that carried the readRealmFile command requests. Result
  // events relate back to it; pairing is ultimately by commandRequestId, so
  // this only needs to be the anchoring bot message.
  requestEventId: string;
  agentId: string | undefined;
  onBehalfOf: string;
  delegatedUserRealmSessions: Pick<
    DelegatedUserRealmSessionManager,
    'getToken' | 'invalidate'
  >;
  fetch?: typeof globalThis.fetch;
  // Injectable for tests; defaults to uploading to the Matrix media repo.
  uploadText?: (content: string, contentType: string) => Promise<string>;
}

export interface ReadRealmFileFulfillmentOutcome {
  commandRequestId: string;
  ok: boolean;
  error?: string;
}

// Upload bytes to the Matrix media repo and return an http download URL that
// both the bot and the host can fetch. Dedupes identical content by hash.
async function uploadTextToMatrix(
  client: MatrixClient,
  content: string,
  contentType: string,
): Promise<string> {
  let hash = createHash('sha256').update(content).digest('hex');
  let cached = uploadedContentUrlByHash.get(hash);
  if (cached) {
    return cached;
  }
  let uploaded = await client.uploadContent(content, { type: contentType });
  let url = client.mxcUrlToHttp(
    uploaded.content_uri,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  );
  if (!url) {
    throw new Error('could not derive a download URL for the uploaded file');
  }
  uploadedContentUrlByHash.set(hash, url);
  return url;
}

// Runs each readRealmFile tool call ai-bot owns and publishes its outcome as a
// command-result event — the same shape a host command result takes, so the
// existing prompt reconstruction pairs it with the request and feeds it back on
// the next turn. On success the fetched file is uploaded to Matrix and attached
// to the result event (data.attachedFiles); the model receives its content via
// the same attachment-download path host-read files use. On failure the result
// event carries the reason and resolves the request as invalid, so a failed
// read reads as failed rather than as a clean read. Returns one outcome per
// call; never throws (a publish failure is logged so the turn still settles).
export async function fulfillReadRealmFileCalls(
  botToolCalls: ChatCompletionMessageToolCall[],
  deps: ReadRealmFileFulfillmentDeps,
): Promise<ReadRealmFileFulfillmentOutcome[]> {
  let upload =
    deps.uploadText ??
    ((content: string, contentType: string) =>
      uploadTextToMatrix(deps.client, content, contentType));
  let outcomes: ReadRealmFileFulfillmentOutcome[] = [];
  for (let call of botToolCalls) {
    if (call.type !== 'function') {
      continue;
    }
    outcomes.push(await fulfillOne(call, deps, upload));
  }
  return outcomes;
}

async function fulfillOne(
  call: ChatCompletionMessageToolCall & { type: 'function' },
  deps: ReadRealmFileFulfillmentDeps,
  upload: (content: string, contentType: string) => Promise<string>,
): Promise<ReadRealmFileFulfillmentOutcome> {
  let args: ReadRealmFileArgs | undefined;
  try {
    args = JSON.parse(call.function.arguments) as ReadRealmFileArgs;
  } catch {
    args = undefined;
  }
  if (!args || !args.realm || !args.url) {
    return await publishFailure(
      call.id,
      'readRealmFile needs a realm and a url.',
      deps,
    );
  }

  let result = await executeReadRealmFile(args, {
    onBehalfOf: deps.onBehalfOf,
    delegatedUserRealmSessions: deps.delegatedUserRealmSessions,
    fetch: deps.fetch,
  });
  if (!result.ok) {
    return await publishFailure(call.id, result.error, deps);
  }

  let label = fileLabelFromUrl(args.url) ?? args.url;
  let fileUrl: string;
  try {
    fileUrl = await upload(result.content, READ_FILE_CONTENT_TYPE);
  } catch (e: any) {
    log.error(
      `readRealmFile: upload failed for ${args.url}: ${e?.message ?? e}`,
    );
    return await publishFailure(
      call.id,
      `could not store ${args.url} for reading`,
      deps,
    );
  }

  await publish(deps, {
    msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
    commandRequestId: call.id,
    'm.relates_to': {
      rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
      key: 'applied',
      event_id: deps.requestEventId,
    },
    data: {
      context: { agentId: deps.agentId },
      attachedFiles: [
        {
          sourceUrl: args.url,
          url: fileUrl,
          name: label,
          contentType: READ_FILE_CONTENT_TYPE,
          contentSize: Buffer.byteLength(result.content),
        },
      ],
    },
  });
  return { commandRequestId: call.id, ok: true };
}

async function publishFailure(
  commandRequestId: string,
  error: string,
  deps: ReadRealmFileFulfillmentDeps,
): Promise<ReadRealmFileFulfillmentOutcome> {
  await publish(deps, {
    msgtype: APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
    commandRequestId,
    failureReason: error,
    'm.relates_to': {
      rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
      key: 'invalid',
      event_id: deps.requestEventId,
    },
    data: { context: { agentId: deps.agentId } },
  });
  return { commandRequestId, ok: false, error };
}

async function publish(
  deps: ReadRealmFileFulfillmentDeps,
  content: Record<string, any>,
): Promise<void> {
  try {
    // eventIdToReplace must stay undefined: sendMatrixEvent overwrites
    // m.relates_to with an m.replace relation when it's set, which would clobber
    // the command-result relation we build here.
    await sendMatrixEvent(
      deps.client,
      deps.roomId,
      APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
      content,
      undefined,
    );
  } catch (e: any) {
    log.error(
      `readRealmFile: failed to publish result for ${content.commandRequestId}: ${
        e?.message ?? e
      }`,
    );
  }
}
