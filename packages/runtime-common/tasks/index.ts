import type * as JSONTypes from 'json-typescript';
import type {
  QueuePublisher,
  DBAdapter,
  IndexWriter,
  Prerenderer,
  Reader,
  RealmPermissions,
  DefinitionLookup,
} from '../index';
import type { JobInfo, IndexingProgressEvent } from '../worker';
export type * from './lint';
export * from '#lint-task';
export * from './full-reindex';
export * from './daily-credit-grant';
export * from './copy';
export * from './indexer';
export * from './run-command';

type LoggerInstance = ReturnType<typeof import('../index').logger>;

export interface TaskArgs {
  dbAdapter: DBAdapter;
  queuePublisher: QueuePublisher;
  indexWriter: IndexWriter;
  prerenderer: Prerenderer;
  definitionLookup: DefinitionLookup;
  log: LoggerInstance;
  matrixURL: string;
  getReader(fetch: typeof global.fetch, realmURL: string): Reader;
  getAuthedFetch(args: WorkerArgs): Promise<typeof globalThis.fetch>;
  createPrerenderAuth(userId: string, permissions: RealmPermissions): string;
  reportStatus(jobInfo: JobInfo | undefined, status: 'start' | 'finish'): void;
  reportProgress?(event: IndexingProgressEvent): void;
}

export type Task<T, K> = (
  args: TaskArgs,
) => (args: T & { jobInfo?: JobInfo }) => Promise<K>;

export interface WorkerArgs extends JSONTypes.Object {
  realmURL: string;
  realmUsername: string;
}
