import type * as JSONTypes from 'json-typescript';
import {
  type QueuePublisher,
  type DBAdapter,
  type logger,
  type IndexWriter,
} from '../index';
import type { JobInfo } from '../worker';
export * from './lint';
export * from './full-reindex';
export * from './copy';

export interface TaskArgs {
  dbAdapter: DBAdapter;
  queuePublisher: QueuePublisher;
  indexWriter: IndexWriter;
  log: ReturnType<typeof logger>;
  getAuthedFetch(args: WorkerArgs): Promise<typeof globalThis.fetch>;
  reportStatus(jobInfo: JobInfo | undefined, status: 'start' | 'finish'): void;
}

export type Task<T, K> = (
  args: TaskArgs,
) => (args: T & { jobInfo?: JobInfo }) => Promise<K>;

export interface WorkerArgs extends JSONTypes.Object {
  realmURL: string;
  realmUsername: string;
}
