import { SlidingSync, type MSC3575List } from 'matrix-js-sdk/lib/sliding-sync';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  SLIDING_SYNC_AI_ROOM_LIST_NAME,
  SLIDING_SYNC_LIST_TIMELINE_LIMIT,
  SLIDING_SYNC_TIMEOUT,
} from '@cardstack/runtime-common/matrix-constants';

export interface SlidingSyncConfig {
  /** Matrix client instance */
  client: MatrixClient;
  /** Custom list name (default: AI room list name from constants) */
  listName?: string;
  /** Timeline limit for sync (default: from constants) */
  timelineLimit?: number;
  /** Sync timeout in ms (default: from constants) */
  timeout?: number;
  /** Custom room filters */
  filters?: {
    is_dm?: boolean;
    [key: string]: unknown;
  };
}

/**
 * Creates a SlidingSync instance configured for bot use.
 *
 * Sliding sync is an efficient way to sync only the rooms the bot cares about,
 * rather than syncing the entire Matrix state.
 *
 * @example
 * ```ts
 * const slidingSync = createSlidingSync({ client });
 * await client.startClient({ slidingSync });
 * ```
 */
export function createSlidingSync(config: SlidingSyncConfig): SlidingSync {
  const {
    client,
    listName = SLIDING_SYNC_AI_ROOM_LIST_NAME,
    timelineLimit = SLIDING_SYNC_LIST_TIMELINE_LIMIT,
    timeout = SLIDING_SYNC_TIMEOUT,
    filters = { is_dm: false },
  } = config;

  let lists: Map<string, MSC3575List> = new Map();
  lists.set(listName, {
    ranges: [[0, 0]],
    filters,
    timeline_limit: timelineLimit,
    required_state: [['*', '*']],
  });

  return new SlidingSync(
    client.baseUrl,
    lists,
    { timeline_limit: timelineLimit },
    client,
    timeout,
  );
}
