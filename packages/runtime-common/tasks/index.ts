import type * as JSONTypes from 'json-typescript';
import type {
  QueuePublisher,
  DBAdapter,
  IndexWriter,
  Prerenderer,
  Reader,
  RealmPermissions,
  DefinitionLookup,
  VirtualNetwork,
} from '../index.ts';
import type { JobInfo, IndexingProgressEvent } from '../worker.ts';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';
export type * from './lint.ts';
export * from '#lint-task';
export * from './full-reindex.ts';
export * from './daily-credit-grant.ts';
export * from './copy.ts';
export * from './indexer.ts';
export * from './prerender-html.ts';
export * from './run-command.ts';
export * from './screenshot-card.ts';

type LoggerInstance = ReturnType<typeof import('../index.ts').logger>;

export interface TaskArgs {
  dbAdapter: DBAdapter;
  queuePublisher: QueuePublisher;
  indexWriter: IndexWriter;
  prerenderer: Prerenderer;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  log: LoggerInstance;
  matrixURL: string;
  getReader(fetch: typeof global.fetch, realmURL: string): Reader;
  getAuthedFetch(args: WorkerArgs): Promise<typeof globalThis.fetch>;
  createPrerenderAuth(userId: string, permissions: RealmPermissions): string;
  reportStatus(jobInfo: JobInfo | undefined, status: 'start' | 'finish'): void;
  reportProgress?(event: IndexingProgressEvent): void;
  // Request that a realm event be broadcast to subscribed hosts. A task runs
  // in a worker child that holds no matrix client; this callback bridges the
  // event to the realm server (through the worker manager), which broadcasts
  // it through the realm's matrix session rooms so it reaches subscribed hosts
  // exactly as a web-tier-originated event does. Transport-agnostic: the task
  // names its realm via the event's `realmURL` and does not know the wire path.
  reportRealmEvent?(event: RealmEventContent): void;
}

export type Task<T, K> = (
  args: TaskArgs,
) => (args: T & { jobInfo?: JobInfo }) => Promise<K>;

export interface WorkerArgs extends JSONTypes.Object {
  realmURL: string;
  realmUsername: string;
}
