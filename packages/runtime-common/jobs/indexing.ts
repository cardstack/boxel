import type {
  CoalescedCaller,
  IncrementalArgs,
  IncrementalChange,
  IncrementalDoneResult,
  IncrementalResult,
} from '../tasks/indexer';
import type { PgPrimitive } from '../expression';
import { v4 as uuidv4 } from '@lukeed/uuid';
import isObjectLike from 'lodash/isObjectLike';

export const INCREMENTAL_INDEX_JOB_TIMEOUT_SEC = 10 * 60;

function parseIncrementalResult(
  result: PgPrimitive,
): IncrementalResult | undefined {
  if (!isObjectLike(result) || Array.isArray(result)) {
    return undefined;
  }
  let { invalidations, ignoreData, stats } = result as Record<
    string,
    PgPrimitive
  >;
  if (
    !Array.isArray(invalidations) ||
    !invalidations.every((value) => typeof value === 'string') ||
    !isObjectLike(ignoreData) ||
    Array.isArray(ignoreData) ||
    !isObjectLike(stats) ||
    Array.isArray(stats)
  ) {
    return undefined;
  }
  return {
    invalidations,
    ignoreData: ignoreData as Record<string, string>,
    stats: stats as IncrementalResult['stats'],
  };
}

export interface IncrementalIndexEnqueueArgs {
  realmURL: string;
  realmUsername: string;
  changes: IncrementalChange[];
  ignoreData: Record<string, string>;
}

export function makeIncrementalArgsWithCallerMetadata(
  args: IncrementalIndexEnqueueArgs,
  clientRequestId: string | null,
): IncrementalArgs {
  let waiterId = uuidv4();
  let coalescedCallers: CoalescedCaller[] = [{ waiterId, clientRequestId }];
  return {
    realmURL: args.realmURL,
    realmUsername: args.realmUsername,
    changes: args.changes,
    ignoreData: args.ignoreData,
    coalescedCallers,
  };
}

export function mapIncrementalDoneResult(
  clientRequestId: string | null,
): (result: PgPrimitive) => IncrementalDoneResult {
  return (result: PgPrimitive) => {
    let parsedResult = parseIncrementalResult(result);
    if (!parsedResult) {
      throw result;
    }
    return {
      ...parsedResult,
      clientRequestId,
    };
  };
}
