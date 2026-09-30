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
import type { MediaCacheAdapter } from '../media-cache.ts';
import type { RealmEventContent } from '@cardstack/base/matrix-event';
export type * from './lint.ts';
export * from '#lint-task';
export * from './full-reindex.ts';
export * from './daily-credit-grant.ts';
export * from './indexer.ts';
export * from './media-cache-gc.ts';
export * from './scoped-css-gc.ts';
export * from './prerender-html.ts';
export * from './prerender-html-reconcile.ts';
export * from './run-command.ts';
export * from './capture-card.ts';

type LoggerInstance = ReturnType<typeof import('../index.ts').logger>;

export interface PrerenderAuthOptions {
  // Mints realm-authority sessions (see `TokenClaims.realmAuthority`). Set by
  // every render whose result is kept and served to others: the ones a realm
  // produces its own index, HTML and definitions with, and a capture that
  // persists. Not set for one whose result goes back only to whoever asked —
  // a command, or a capture answered to its requester — which runs as that
  // user.
  realmAuthority?: true;
}

// The session a prerender tab authenticates as, one token per realm
// `permissions` names, serialized the way the tab reads it.
export type CreatePrerenderAuth = (
  userId: string,
  permissions: RealmPermissions,
  opts?: PrerenderAuthOptions,
) => string;

export interface TaskArgs {
  dbAdapter: DBAdapter;
  queuePublisher: QueuePublisher;
  indexWriter: IndexWriter;
  prerenderer: Prerenderer;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  log: LoggerInstance;
  matrixURL: string;
  // The MediaCache's object store. Optional: a worker process without one
  // configured still registers media-cache jobs, whose tasks then no-op.
  mediaCacheAdapter?: MediaCacheAdapter;
  // Realms whose from-scratch index must not spawn the follow-on
  // `prerender_html` job. A test harness affordance, empty everywhere else —
  // see `--skipPrerenderHtmlRealm` in realm-server/worker.ts for what it costs.
  skipPrerenderHtmlRealms?: string[];
  getReader(fetch: typeof global.fetch, realmURL: string): Reader;
  getAuthedFetch(args: WorkerArgs): Promise<typeof globalThis.fetch>;
  createPrerenderAuth: CreatePrerenderAuth;
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
