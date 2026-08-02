import type {
  RealmNotebookInputReference,
  RealmNotebookRequest,
  RealmProgramActivity,
  RealmProgramExecutor,
  RealmProgramMode,
} from '@cardstack/runtime-common';

export type {
  RealmNotebookInputReference,
  RealmNotebookRequest,
  RealmProgramActivity,
} from '@cardstack/runtime-common';

export interface BxlEvaluator {
  evaluate(
    expression: string,
    input: unknown,
    options?: object,
  ): unknown | Promise<unknown>;
}

export interface RealmProgramChange {
  operation: 'create' | 'update' | 'remove';
  path: string;
  beforeHash: string | null;
  afterHash: string | null;
  diff: string;
}

export interface RealmProgramEffect {
  scope: 'realm' | 'server';
  realm?: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  status: number | null;
  ok: boolean | null;
}

export interface RealmProgramResult {
  ok: true;
  mode: RealmProgramMode;
  value: unknown;
  changes: RealmProgramChange[];
  effects: RealmProgramEffect[];
  logs: Array<{ level: string; args: unknown[] }>;
  stats: {
    capabilityCalls: number;
    filesRead: number;
    filesChanged: number;
    bytesRead: number;
    bytesWritten: number;
    apiRequests: number;
    apiBytesSent: number;
    apiBytesReceived: number;
    durationMs: number;
  };
}

export interface RealmNotebookMetadata {
  sessionId: string;
  cellId: string;
  revision: number;
  executionId: string;
  persistence: 'ephemeral' | 'realm';
  expiresAt: number | null;
  reused: boolean;
  outputRef: { executionId: string; pointer: string };
  snapshot: {
    createdAt: number;
    updatedAt: number;
    cells: Array<{
      cellId: string;
      position: number;
      source: string;
      sourceTruncated: boolean;
      mode: RealmProgramMode;
      inputs: Record<string, RealmNotebookInputReference>;
      literalInputKeys: string[];
      revision: number | null;
      lastRevision: number | null;
      executionId: string | null;
      outputRef: { executionId: string; pointer: string } | null;
      status: 'saved' | 'pending' | 'succeeded' | 'failed' | 'indeterminate';
      stale: boolean;
    }>;
  };
}

export class RealmRunnerError extends Error {
  code: string;
  details?: unknown;
}

export function errorDetails(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
};

export class BxlAdapter implements BxlEvaluator {
  constructor(evaluate: BxlEvaluator['evaluate']);
  static create(): Promise<BxlAdapter>;
  evaluate(
    expression: string,
    input: unknown,
    options?: object,
  ): unknown | Promise<unknown>;
}

export class RealmCapabilityHost {
  constructor(options: {
    adapter: object;
    bxl?: BxlEvaluator;
    realmUrl: string;
    mode?: RealmProgramMode;
    limits?: Record<string, number>;
  });
  dispatch(operation: string, args: unknown[]): Promise<unknown>;
  finish(): Promise<{
    changes: RealmProgramChange[];
    effects: RealmProgramEffect[];
    logs: RealmProgramResult['logs'];
    stats: Omit<RealmProgramResult['stats'], 'durationMs'>;
  }>;
}

export class BoxelHttpAdapter {
  constructor(options: {
    fetch: typeof globalThis.fetch;
    authorization: string;
    realmServerUrl: string;
    requestTimeoutMs?: number;
    responseLimitBytes?: number;
  });
}

export const DEFAULT_LIMITS: Readonly<Record<string, number>>;
export const DEFAULT_RUNTIME_LIMITS: Readonly<Record<string, number>>;

export interface RealmProgramExecutorOptions {
  fetch?: typeof globalThis.fetch;
  bxl?: BxlEvaluator;
  realmServerUrl?: string;
  onBxlUnavailable?: (error: unknown) => void;
  notebookEncryptionKey?: string;
  notebookStorage?: MemoryNotebookStorage;
  now?: () => number;
}

export class QuickJSRealmProgramExecutor implements RealmProgramExecutor {
  constructor(options?: RealmProgramExecutorOptions);
  execute(input: {
    code?: string;
    mode: RealmProgramMode;
    realmURL: string;
    authorization: string | null;
    input?: unknown;
    notebook?: RealmNotebookRequest;
    onActivity?: (activity: RealmProgramActivity) => void | Promise<void>;
  }): Promise<RealmProgramResult & { notebook?: RealmNotebookMetadata }>;
}

export function createRealmProgramExecutor(
  options?: RealmProgramExecutorOptions,
): Promise<QuickJSRealmProgramExecutor>;

export function runRealmScript(options: {
  code: string;
  realm: string;
  mode?: RealmProgramMode;
  input?: unknown;
  notebook?: object | null;
  adapter: object;
  bxl?: BxlEvaluator;
  limits?: object;
  onActivity?: (activity: RealmProgramActivity) => void | Promise<void>;
}): Promise<RealmProgramResult>;

export interface NotebookStorageAdapter {
  get(key: string): Promise<unknown | undefined>;
  set(
    key: string,
    value: unknown,
    options?: { expiresAt?: number | null },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryNotebookStorage implements NotebookStorageAdapter {
  constructor(options?: { now?: () => number; maxEntries?: number });
  get(key: string): Promise<unknown | undefined>;
  set(
    key: string,
    value: unknown,
    options?: { expiresAt?: number | null },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  touchPrefix(prefix: string, expiresAt: number | null): Promise<void>;
  prune(): void;
}

export class RealmFileNotebookStorage implements NotebookStorageAdapter {
  constructor(options: {
    adapter: object;
    realmUrl: string;
    prefix?: string;
    maxRecordBytes?: number;
    now?: () => number;
  });
  get(key: string): Promise<unknown | undefined>;
  set(
    key: string,
    value: unknown,
    options?: { expiresAt?: number | null },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export class EncryptedNotebookStorage implements NotebookStorageAdapter {
  constructor(options: {
    storage: NotebookStorageAdapter;
    keyMaterial: string;
  });
  get(key: string): Promise<unknown | undefined>;
  set(
    key: string,
    value: unknown,
    options?: { expiresAt?: number | null },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export class RealmNotebookCoordinator {
  constructor(options?: {
    ephemeralStorage?: MemoryNotebookStorage;
    encryptionKey?: string;
    now?: () => number;
  });
}
