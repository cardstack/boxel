import {
  BRANCH_HEAD_SPEC,
  ConditionalWriteConflictError,
  RefConflictError,
  canonicalInstant,
  canonicalJson,
  updateConditionalBranchHead,
  type BranchHead,
  type BranchHeadState,
  type ConditionalObjectStore,
  type JsonValue,
} from '@cardstack/deck/node';

export const PREPARED_BRANCH_UPDATE_SPEC =
  'boxel-deck-prepared-branch-update-v1';

export interface PreparedBranchUpdate {
  schema: typeof PREPARED_BRANCH_UPDATE_SPEC;
  id: string;
  writerId: string;
  branchKey: string;
  expectedGeneration: number | null;
  next: BranchHeadState;
  createdAt: string;
}

const PREPARED_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export function preparedBranchUpdateKey(id: string): string {
  if (!PREPARED_ID.test(id)) throw new Error('invalid prepared update id');
  return `.deck/prepared/branch-updates/${id}.json`;
}

function preparedUpdate(value: PreparedBranchUpdate): PreparedBranchUpdate {
  if (
    value.schema !== PREPARED_BRANCH_UPDATE_SPEC ||
    !PREPARED_ID.test(value.id) ||
    value.writerId.trim() === '' ||
    value.branchKey.trim() === '' ||
    !(
      value.expectedGeneration === null ||
      (Number.isSafeInteger(value.expectedGeneration) &&
        value.expectedGeneration >= 1)
    )
  ) {
    throw new Error('invalid prepared branch update');
  }
  return { ...value, createdAt: canonicalInstant(value.createdAt) };
}

function parsePrepared(bytes: Buffer): PreparedBranchUpdate {
  return preparedUpdate(
    JSON.parse(bytes.toString('utf8')) as PreparedBranchUpdate,
  );
}

function sameNext(head: BranchHead, prepared: PreparedBranchUpdate): boolean {
  return (
    head.schema === BRANCH_HEAD_SPEC &&
    head.generation === (prepared.expectedGeneration ?? 0) + 1 &&
    head.repositoryHash === prepared.next.repositoryHash &&
    head.historyHead === prepared.next.historyHead &&
    head.indexGenerationHash === prepared.next.indexGenerationHash &&
    head.latestCheckpointHash === prepared.next.latestCheckpointHash
  );
}

function parseBranchHead(bytes: Buffer): BranchHead {
  let value = JSON.parse(bytes.toString('utf8')) as BranchHead;
  if (
    value.schema !== BRANCH_HEAD_SPEC ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1
  ) {
    throw new Error('invalid branch head during prepared-update recovery');
  }
  return value;
}

export async function prepareBranchUpdate(options: {
  objects: ConditionalObjectStore;
  id: string;
  writerId: string;
  branchKey: string;
  expectedGeneration: number | null;
  next: BranchHeadState;
  createdAt: string;
}): Promise<PreparedBranchUpdate> {
  let value = preparedUpdate({
    schema: PREPARED_BRANCH_UPDATE_SPEC,
    id: options.id,
    writerId: options.writerId,
    branchKey: options.branchKey,
    expectedGeneration: options.expectedGeneration,
    next: options.next,
    createdAt: options.createdAt,
  });
  let key = preparedBranchUpdateKey(value.id);
  let bytes = canonicalJson(value as unknown as JsonValue);
  try {
    await options.objects.put(key, bytes, { ifNoneMatch: '*' });
  } catch (error) {
    if (!(error instanceof ConditionalWriteConflictError)) throw error;
    let existing = await options.objects.get(key);
    if (!existing || !existing.bytes.equals(bytes)) throw error;
  }
  return value;
}

export async function commitPreparedBranchUpdate(options: {
  objects: ConditionalObjectStore;
  id: string;
  writerId: string;
}): Promise<{ head: BranchHead; recovered: boolean }> {
  let preparedObject = await options.objects.get(
    preparedBranchUpdateKey(options.id),
  );
  if (!preparedObject)
    throw new Error(`prepared update not found: ${options.id}`);
  let prepared = parsePrepared(preparedObject.bytes);
  if (prepared.writerId !== options.writerId) {
    throw new Error(
      `prepared update ${options.id} belongs to writer ${prepared.writerId}`,
    );
  }
  try {
    return {
      head: await updateConditionalBranchHead({
        objects: options.objects,
        key: prepared.branchKey,
        expectedGeneration: prepared.expectedGeneration,
        next: prepared.next,
      }),
      recovered: false,
    };
  } catch (error) {
    if (
      !(error instanceof RefConflictError) &&
      !(error instanceof ConditionalWriteConflictError)
    ) {
      throw error;
    }
    let current = await options.objects.get(prepared.branchKey);
    if (current) {
      let head = parseBranchHead(current.bytes);
      if (sameNext(head, prepared)) return { head, recovered: true };
    }
    throw error;
  }
}
