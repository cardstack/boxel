import { createHash } from 'crypto';
import { logger } from '@cardstack/runtime-common';
import { sendMatrixEvent } from '@cardstack/runtime-common/ai';
import { APP_BOXEL_TOOL_RESULT_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type { MatrixClient } from 'matrix-js-sdk';

// What every tool ai-bot runs itself does with what it read: store it in the
// Matrix media repo and publish the call's tool-result event.

let log = logger('ai-bot:bot-tools');

// Maps a fetched file's content hash to the Matrix media URL it was uploaded
// under, so identical bytes (the same skill read across rooms or turns) are
// uploaded once and re-referenced. Keyed on a SHA-256 of the content, so a
// changed file misses the cache and re-uploads — dedup without staleness.
// Matrix media is not content-addressable (each upload gets a fresh id), so
// this app-level cache is what keeps us from re-storing the same bytes.
const uploadedContentUrlByHash = new Map<string, string>();

// Upload bytes to the Matrix media repo and return an http download URL that
// both the bot and the host can fetch. Dedupes identical content by hash.
export async function uploadToMatrix(
  client: MatrixClient,
  content: string | Uint8Array,
  contentType: string,
): Promise<string> {
  let hash = createHash('sha256')
    .update(contentType)
    .update('\0')
    .update(content)
    .digest('hex');
  let cached = uploadedContentUrlByHash.get(hash);
  if (cached) {
    return cached;
  }
  let uploaded = await client.uploadContent(
    typeof content === 'string' ? content : Buffer.from(content),
    { type: contentType },
  );
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

// Publishes a tool-result event for a call ai-bot fulfilled itself — the
// same shape a host command result takes, so prompt reconstruction pairs it
// with the request and the event re-triggers the bot for the continuation
// turn. Never throws: a publish failure is logged so the turn still settles,
// and reported by returning false.
export async function publishToolResult(
  client: MatrixClient,
  roomId: string,
  content: Record<string, any>,
  toolName: string,
): Promise<boolean> {
  try {
    // eventIdToReplace must stay undefined: sendMatrixEvent overwrites
    // m.relates_to with an m.replace relation when it's set, which would clobber
    // the command-result relation we build here.
    await sendMatrixEvent(
      client,
      roomId,
      APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
      content,
      undefined,
    );
    return true;
  } catch (e: any) {
    log.error(
      `${toolName}: failed to publish result for ${content.commandRequestId}: ${
        e?.message ?? e
      }`,
    );
    return false;
  }
}
