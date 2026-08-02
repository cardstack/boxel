import { errorDetails, RealmRunnerError } from './errors.js';
import {
  EncryptedNotebookStorage,
  MemoryNotebookStorage,
  RealmFileNotebookStorage,
} from './notebook-storage.js';

const textEncoder = new TextEncoder();
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_INPUTS = 64;
const MAX_CELLS = 128;
const MAX_CELL_SOURCE_PREVIEW_CHARS = 8 * 1024;
const MAX_NOTEBOOK_SOURCE_PREVIEW_CHARS = 64 * 1024;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function byteLength(value) {
  return textEncoder.encode(JSON.stringify(value)).byteLength;
}

async function sha256(value) {
  let digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function jwtUser(authorization) {
  if (typeof authorization !== 'string') return 'anonymous';
  try {
    let token = authorization.replace(/^Bearer\s+/i, '');
    let payload = token.split('.')[1];
    if (!payload) return 'anonymous';
    let base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    base64 += '='.repeat((4 - (base64.length % 4)) % 4);
    let claims = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)),
      ),
    );
    return typeof claims.user === 'string' && claims.user.length > 0
      ? claims.user
      : 'anonymous';
  } catch {
    return 'anonymous';
  }
}

function validateIdentifier(value, name) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 256
  ) {
    throw new RealmRunnerError(
      'INVALID_ARGUMENT',
      `Realm Notebook ${name} must be a non-empty string no longer than 256 characters`,
    );
  }
  return value;
}

function validateDescriptor(notebook) {
  if (!notebook || typeof notebook !== 'object' || Array.isArray(notebook)) {
    throw new RealmRunnerError(
      'INVALID_ARGUMENT',
      'Realm Notebook settings must be an object',
    );
  }
  let persistence = notebook.persistence ?? 'ephemeral';
  if (persistence !== 'ephemeral' && persistence !== 'realm') {
    throw new RealmRunnerError(
      'INVALID_ARGUMENT',
      'Realm Notebook persistence must be "ephemeral" or "realm"',
    );
  }
  let ttlMs = notebook.ttlMs ?? DEFAULT_TTL_MS;
  if (
    persistence === 'ephemeral' &&
    (!Number.isSafeInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS)
  ) {
    throw new RealmRunnerError(
      'INVALID_ARGUMENT',
      `Ephemeral Realm Notebook ttlMs must be between ${MIN_TTL_MS} and ${MAX_TTL_MS}`,
    );
  }
  let inputs = notebook.inputs ?? {};
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    throw new RealmRunnerError(
      'INVALID_ARGUMENT',
      'Realm Notebook inputs must be an object',
    );
  }
  if (Object.keys(inputs).length > MAX_INPUTS) {
    throw new RealmRunnerError(
      'NOTEBOOK_INPUT_LIMIT',
      `Realm Notebook cells accept at most ${MAX_INPUTS} inputs`,
    );
  }
  return {
    sessionId: validateIdentifier(notebook.sessionId, 'sessionId'),
    cellId: validateIdentifier(notebook.cellId, 'cellId'),
    persistence,
    ttlMs,
    inputs: notebook.inputs === undefined ? undefined : inputs,
    force: notebook.force === true,
    runSaved: notebook.runSaved === true,
  };
}

function resolveJsonPointer(value, pointer) {
  if (pointer === '') return value;
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new RealmRunnerError(
      'INVALID_ARGUMENT',
      'Realm Notebook input pointer must be an RFC 6901 JSON pointer',
    );
  }
  let current = value;
  for (let rawToken of pointer.slice(1).split('/')) {
    let token = rawToken.replace(/~1/g, '/').replace(/~0/g, '~');
    if (
      current === null ||
      typeof current !== 'object' ||
      !(token in current)
    ) {
      throw new RealmRunnerError(
        'NOTEBOOK_INPUT_NOT_FOUND',
        `Realm Notebook input pointer ${pointer} does not exist`,
      );
    }
    current = current[token];
  }
  return current;
}

function executionKey(scope, executionId) {
  return `${scope}/executions/${executionId}`;
}

function notebookSnapshot(manifest) {
  let remainingSourceChars = MAX_NOTEBOOK_SOURCE_PREVIEW_CHARS;
  return {
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    cells: Object.entries(manifest.cells).map(([cellId, cell], position) => {
      let definition = cell.definition ?? {};
      let source = String(definition.code ?? '');
      let sourceChars = Math.min(
        source.length,
        MAX_CELL_SOURCE_PREVIEW_CHARS,
        remainingSourceChars,
      );
      let sourcePreview = source.slice(0, sourceChars);
      remainingSourceChars -= sourceChars;
      let stale = Object.entries(definition.inputs ?? {}).some(
        ([name, inputRef]) =>
          inputRef?.cellId &&
          manifest.cells[inputRef.cellId]?.executionId !==
            cell.resolvedInputs?.[name]?.executionId,
      );
      return {
        cellId,
        position,
        source: sourcePreview,
        sourceTruncated: sourcePreview.length < source.length,
        mode: definition.mode,
        inputs: clone(definition.inputs ?? {}),
        literalInputKeys: Object.keys(definition.input ?? {}),
        revision: cell.revision ?? null,
        lastRevision: cell.lastRevision ?? cell.revision ?? null,
        executionId: cell.executionId ?? null,
        outputRef:
          cell.executionId === undefined
            ? null
            : { executionId: cell.executionId, pointer: '/result/value' },
        status: cell.lastAttempt?.status ?? cell.status ?? 'saved',
        stale,
      };
    }),
  };
}

function notebookMetadata({
  descriptor,
  revision,
  executionId,
  reused,
  expiresAt,
  manifest,
}) {
  return {
    sessionId: descriptor.sessionId,
    cellId: descriptor.cellId,
    revision,
    executionId,
    persistence: descriptor.persistence,
    expiresAt,
    reused,
    outputRef: { executionId, pointer: '/result/value' },
    snapshot: notebookSnapshot(manifest),
  };
}

export class RealmNotebookCoordinator {
  constructor({
    ephemeralStorage = new MemoryNotebookStorage(),
    encryptionKey,
    now = () => Date.now(),
  } = {}) {
    this.ephemeralStorage = ephemeralStorage;
    this.encryptionKey = encryptionKey;
    this.now = now;
    this.locks = new Map();
  }

  persistentStorage(adapter, realmUrl) {
    if (typeof this.encryptionKey !== 'string') {
      throw new RealmRunnerError(
        'NOTEBOOK_PERSISTENCE_UNAVAILABLE',
        'Durable Realm Notebook storage is not configured on this server',
      );
    }
    return new EncryptedNotebookStorage({
      storage: new RealmFileNotebookStorage({
        adapter,
        realmUrl,
        now: this.now,
      }),
      keyMaterial: this.encryptionKey,
    });
  }

  async withLock(key, callback) {
    let previous = this.locks.get(key) ?? Promise.resolve();
    let release;
    let current = new Promise((resolve) => (release = resolve));
    this.locks.set(key, current);
    await previous;
    try {
      return await callback();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }

  async execute({
    notebook,
    input,
    code,
    mode,
    realmURL,
    authorization,
    adapter,
    run,
  }) {
    let descriptor = validateDescriptor(notebook);
    let owner = jwtUser(authorization);
    let scope = await sha256(
      JSON.stringify([owner, realmURL, descriptor.sessionId]),
    );
    let storage =
      descriptor.persistence === 'realm'
        ? this.persistentStorage(adapter, realmURL)
        : this.ephemeralStorage;
    return this.withLock(scope, async () => {
      return this.executeLocked({
        descriptor,
        scope,
        owner,
        storage,
        directInput: input,
        code,
        mode,
        realmURL,
        run,
      });
    });
  }

  async executeLocked({
    descriptor,
    scope,
    owner,
    storage,
    directInput,
    code,
    mode,
    realmURL,
    run,
  }) {
    let now = this.now();
    let expiresAt =
      descriptor.persistence === 'ephemeral' ? now + descriptor.ttlMs : null;
    let manifestKey = `${scope}/manifest`;
    let manifest = await storage.get(manifestKey);
    if (
      manifest &&
      descriptor.persistence === 'ephemeral' &&
      typeof storage.touchPrefix === 'function'
    ) {
      await storage.touchPrefix(scope, expiresAt);
    }
    if (manifest && manifest.sessionId !== descriptor.sessionId) {
      throw new RealmRunnerError(
        'NOTEBOOK_CORRUPT',
        'Realm Notebook manifest does not match the requested session',
      );
    }
    manifest ??= {
      version: 1,
      sessionId: descriptor.sessionId,
      owner,
      realmURL,
      persistence: descriptor.persistence,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      cells: {},
    };

    let previousCell = manifest.cells[descriptor.cellId];
    if (descriptor.runSaved) {
      if (!previousCell?.definition) {
        throw new RealmRunnerError(
          'NOTEBOOK_CELL_NOT_FOUND',
          `Realm Notebook cell ${descriptor.cellId} has no saved definition`,
        );
      }
      if (previousCell.definition.mode !== mode) {
        throw new RealmRunnerError(
          'NOTEBOOK_MODE_MISMATCH',
          `Saved Realm Notebook cell ${descriptor.cellId} uses mode ${previousCell.definition.mode}, not ${mode}`,
        );
      }
      code = previousCell.definition.code;
      descriptor.inputs = clone(previousCell.definition.inputs ?? {});
      if (directInput === undefined) {
        directInput = clone(previousCell.definition.input ?? {});
      }
    }
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new RealmRunnerError(
        'EMPTY_SCRIPT',
        'Realm Notebook cell source is empty',
      );
    }
    descriptor.inputs ??= {};
    directInput ??= {};
    if (
      !directInput ||
      typeof directInput !== 'object' ||
      Array.isArray(directInput)
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'Realm Notebook literal input must be a JSON object',
      );
    }

    let { values: referencedInput, refs: inputRefs } = await this.resolveInputs(
      {
        descriptor,
        manifest,
        scope,
        storage,
        expiresAt,
      },
    );
    let duplicateInput = Object.keys(referencedInput).find((name) =>
      Object.hasOwn(directInput, name),
    );
    if (duplicateInput) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        `Realm Notebook input ${duplicateInput} is supplied as both a literal value and a cell reference`,
      );
    }
    let input = { ...clone(directInput), ...referencedInput };
    if (byteLength(input) > MAX_INPUT_BYTES) {
      throw new RealmRunnerError(
        'NOTEBOOK_INPUT_LIMIT',
        `Resolved Realm Notebook inputs exceed ${MAX_INPUT_BYTES} bytes`,
      );
    }

    let codeHash = await sha256(code);
    let inputValueHash = await sha256(JSON.stringify(directInput));
    let specHash = await sha256(
      JSON.stringify({ codeHash, mode, inputRefs, inputValueHash }),
    );
    let sameSpec = previousCell?.specHash === specHash;
    let revision = previousCell
      ? (previousCell.lastRevision ?? previousCell.revision) + 1
      : 1;
    if (sameSpec && !descriptor.force) revision = previousCell.revision;
    let executionId = await sha256(
      JSON.stringify([scope, descriptor.cellId, revision, specHash]),
    );
    let recordKey = executionKey(scope, executionId);
    let existing = await storage.get(recordKey);

    if (existing?.status === 'succeeded' && !descriptor.force) {
      manifest.cells[descriptor.cellId] = {
        ...previousCell,
        revision,
        lastRevision: Math.max(previousCell?.lastRevision ?? 0, revision),
        executionId,
        specHash,
        status: 'succeeded',
        updatedAt: now,
        resolvedInputs: clone(inputRefs),
        definition: {
          code,
          mode,
          input: clone(directInput),
          inputs: clone(descriptor.inputs),
        },
        lastAttempt: { executionId, specHash, status: 'succeeded' },
      };
      manifest.updatedAt = now;
      manifest.expiresAt = expiresAt;
      await storage.set(manifestKey, manifest, { expiresAt });
      await storage.set(recordKey, existing, { expiresAt });
      return {
        ...clone(existing.result),
        notebook: notebookMetadata({
          descriptor,
          revision,
          executionId,
          reused: true,
          expiresAt,
          manifest,
        }),
      };
    }
    if (
      existing?.status === 'pending' ||
      existing?.status === 'indeterminate'
    ) {
      throw new RealmRunnerError(
        'NOTEBOOK_EXECUTION_INDETERMINATE',
        `Realm Notebook cell ${descriptor.cellId} may already have executed; use a new cell revision instead of retrying it`,
        { executionId, status: existing.status },
      );
    }
    if (
      !descriptor.force &&
      previousCell?.lastAttempt?.specHash === specHash &&
      ['pending', 'indeterminate'].includes(previousCell.lastAttempt.status)
    ) {
      throw new RealmRunnerError(
        'NOTEBOOK_EXECUTION_INDETERMINATE',
        `Realm Notebook cell ${descriptor.cellId} may already have executed; rerun it explicitly to create a new revision`,
        {
          executionId: previousCell.lastAttempt.executionId,
          status: previousCell.lastAttempt.status,
        },
      );
    }

    if (!previousCell && Object.keys(manifest.cells).length >= MAX_CELLS) {
      throw new RealmRunnerError(
        'NOTEBOOK_STORAGE_LIMIT',
        `Realm Notebook sessions are limited to ${MAX_CELLS} cells`,
      );
    }

    let pending = {
      version: 1,
      executionId,
      sessionId: descriptor.sessionId,
      cellId: descriptor.cellId,
      revision,
      specHash,
      codeHash,
      code,
      mode,
      input: clone(directInput),
      inputRefs,
      status: 'pending',
      startedAt: now,
    };
    await storage.set(recordKey, pending, { expiresAt });
    manifest.cells[descriptor.cellId] = {
      ...previousCell,
      lastRevision: revision,
      definition: {
        code,
        mode,
        input: clone(directInput),
        inputs: clone(descriptor.inputs),
      },
      lastAttempt: { executionId, specHash, status: 'pending' },
      updatedAt: now,
    };
    manifest.updatedAt = now;
    manifest.expiresAt = expiresAt;
    await storage.set(manifestKey, manifest, { expiresAt });

    let result;
    try {
      result = await run(input, code, {
        sessionId: descriptor.sessionId,
        cellId: descriptor.cellId,
        revision,
        executionId,
        persistence: descriptor.persistence,
      });
    } catch (error) {
      let failureStatus = mode === 'commit' ? 'indeterminate' : 'failed';
      let failed = {
        ...pending,
        status: failureStatus,
        finishedAt: this.now(),
        error: errorDetails(error),
      };
      try {
        await storage.set(recordKey, failed, { expiresAt });
        manifest.cells[descriptor.cellId].lastAttempt = {
          executionId,
          specHash,
          status: failureStatus,
        };
        manifest.cells[descriptor.cellId].updatedAt = this.now();
        manifest.updatedAt = this.now();
        await storage.set(manifestKey, manifest, { expiresAt });
      } catch {
        // Preserve the execution error. A leftover pending record is the safe
        // retry posture because it prevents a possibly-effectful rerun.
      }
      let failureNotebook = notebookMetadata({
        descriptor,
        revision,
        executionId,
        reused: false,
        expiresAt,
        manifest,
      });
      if (error instanceof RealmRunnerError) {
        error.details = {
          ...(error.details &&
          typeof error.details === 'object' &&
          !Array.isArray(error.details)
            ? error.details
            : {}),
          notebook: failureNotebook,
        };
        throw error;
      }
      throw new RealmRunnerError(
        'RUNTIME_ERROR',
        error instanceof Error ? error.message : String(error),
        { notebook: failureNotebook },
      );
    }

    let finishedAt = this.now();
    let succeeded = {
      ...pending,
      status: 'succeeded',
      finishedAt,
      result: clone(result),
    };
    await storage.set(recordKey, succeeded, { expiresAt });
    manifest.cells[descriptor.cellId] = {
      ...manifest.cells[descriptor.cellId],
      revision,
      lastRevision: revision,
      executionId,
      specHash,
      status: 'succeeded',
      updatedAt: finishedAt,
      resolvedInputs: clone(inputRefs),
      lastAttempt: { executionId, specHash, status: 'succeeded' },
    };
    manifest.updatedAt = finishedAt;
    manifest.expiresAt = expiresAt;
    await storage.set(manifestKey, manifest, { expiresAt });
    return {
      ...result,
      notebook: notebookMetadata({
        descriptor,
        revision,
        executionId,
        reused: false,
        expiresAt,
        manifest,
      }),
    };
  }

  async resolveInputs({ descriptor, manifest, scope, storage, expiresAt }) {
    let values = {};
    let refs = {};
    for (let [name, inputRef] of Object.entries(descriptor.inputs)) {
      if (
        !inputRef ||
        typeof inputRef !== 'object' ||
        Array.isArray(inputRef)
      ) {
        throw new RealmRunnerError(
          'INVALID_ARGUMENT',
          `Realm Notebook input ${name} must be a cell or execution reference`,
        );
      }
      let sourceExecutionId = inputRef.executionId;
      if (sourceExecutionId === undefined && inputRef.cellId !== undefined) {
        validateIdentifier(inputRef.cellId, `input ${name} cellId`);
        sourceExecutionId = manifest.cells[inputRef.cellId]?.executionId;
      }
      if (
        typeof sourceExecutionId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(sourceExecutionId)
      ) {
        throw new RealmRunnerError(
          'NOTEBOOK_INPUT_NOT_FOUND',
          `Realm Notebook input ${name} does not reference a completed cell`,
        );
      }
      let pointer = inputRef.pointer ?? '/result/value';
      let sourceKey = executionKey(scope, sourceExecutionId);
      let execution = await storage.get(sourceKey);
      if (!execution || execution.status !== 'succeeded') {
        throw new RealmRunnerError(
          'NOTEBOOK_INPUT_NOT_FOUND',
          `Realm Notebook input ${name} references an unavailable execution`,
        );
      }
      values[name] = clone(resolveJsonPointer(execution, pointer));
      refs[name] = { executionId: sourceExecutionId, pointer };
      await storage.set(sourceKey, execution, { expiresAt });
    }
    return { values, refs };
  }
}

export { DEFAULT_TTL_MS, MAX_TTL_MS, MIN_TTL_MS, resolveJsonPointer };
