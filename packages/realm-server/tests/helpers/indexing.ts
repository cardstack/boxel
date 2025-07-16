import type { MatrixEvent } from 'https://cardstack.com/base/matrix-event';
import { findRealmEvent, waitUntil } from './index';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { trimJsonExtension } from '@cardstack/runtime-common';
import type {
  IncrementalIndexEventContent,
  IncrementalIndexInitiationContent,
} from 'https://cardstack.com/base/matrix-event';
import { validate as uuidValidate } from 'uuid';

interface IncrementalIndexEventTestContext {
  assert: Assert;
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>;
  realm: string;
}

export async function waitForIncrementalIndexEvent(
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>,
  since: number,
) {
  await waitUntil(async () => {
    let matrixMessages = await getMessagesSince(since);

    return matrixMessages.some(
      (m) =>
        m.type === APP_BOXEL_REALM_EVENT_TYPE &&
        m.content.eventName === 'index' &&
        m.content.indexType === 'incremental',
    );
  });
}

export async function expectIncrementalIndexEvent(
  url: string, // <>.gts OR <>.json OR <>/
  since: number,
  opts: IncrementalIndexEventTestContext,
) {
  let { assert, getMessagesSince, realm } = opts;

  let endsWithSlash = url.endsWith('/'); // new card def is being created

  if (!url.endsWith('.json') && !url.endsWith('.gts') && !endsWithSlash) {
    throw new Error('Invalid file path');
  }
  await waitForIncrementalIndexEvent(getMessagesSince, since);

  let messages = await getMessagesSince(since);
  let incrementalIndexInitiationEventContent = findRealmEvent(
    messages,
    'index',
    'incremental-index-initiation',
  )?.content as IncrementalIndexInitiationContent;

  let incrementalEventContent = findRealmEvent(messages, 'index', 'incremental')
    ?.content as IncrementalIndexEventContent;

  let targetUrl = url;
  if (endsWithSlash) {
    let maybeLocalId = incrementalEventContent.invalidations[0]
      .split('/')
      .pop();
    // check if the card identifier is a UUID
    assert.true(uuidValidate(maybeLocalId!), 'card identifier is a UUID');
    assert.strictEqual(
      incrementalEventContent.invalidations[0],
      `${realm}CardDef/${maybeLocalId}`,
    );
    targetUrl = `${realm}CardDef/${maybeLocalId}.json`;
  }

  // For instances, the updatedFile includes .json extension but invalidations don't
  // For source files, both updatedFile and invalidations include the full path with extension
  let invalidation = targetUrl.endsWith('.json')
    ? trimJsonExtension(targetUrl)
    : targetUrl;

  if (!incrementalIndexInitiationEventContent) {
    throw new Error('Incremental index initiation event not found');
  }
  if (!incrementalEventContent) {
    throw new Error('Incremental event content not found');
  }
  assert.deepEqual(incrementalIndexInitiationEventContent, {
    eventName: 'index',
    indexType: 'incremental-index-initiation',
    updatedFile: targetUrl,
  });

  let expectedIncrementalContent: any = {
    eventName: 'index',
    indexType: 'incremental',
    invalidations: [invalidation],
  };

  let actualContent = { ...incrementalEventContent };
  delete actualContent.clientRequestId;

  assert.deepEqual(actualContent, expectedIncrementalContent);
  return incrementalEventContent;
}
