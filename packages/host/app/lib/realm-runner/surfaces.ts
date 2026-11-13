import type { RealmRunnerCallMethod, RealmRunnerSurface } from './types';

// What a method can reach outside QuickJS. The automation surface's allowlist
// is judged by this (ADR 025 §1.4): an automation run may only read its own
// realm, stage writes that land in one batch after the script finishes, call
// operations (a `callApi` reaches the network only through one), ask the
// model through `resolve`, and report its progress and console lines to the
// run record.
export type RealmRunnerMethodReach =
  // reads the run's realm
  | 'realm-read'
  // writes a file, staged in an automation run, saved at once in an
  // interactive one
  | 'realm-write'
  // removes a file from the realm at once
  | 'realm-delete'
  // a card operation: a `callApi` reaches its vendor, a write operation
  // writes
  | 'operation'
  // a model call through the realm server's proxy
  | 'model'
  // BXL in a worker beside QuickJS; touches nothing outside it
  | 'transform'
  // fetches from, or searches, the open web
  | 'web'
  // generates an image through a model and saves it
  | 'image'
  // renders a card in a browser
  | 'capture'
  // creates or deletes a workspace
  | 'workspace'
  // changes the chat room
  | 'room'
  // changes what the person sees
  | 'ui'
  // starts or stops indexing
  | 'index'
  // waits on a person
  | 'person'
  // reports progress: the chat in an interactive run, the run record in an
  // automation run
  | 'progress'
  // a console line, written to the run record
  | 'log';

// A Record over every method, so a new method does not type-check until its
// reach is stated here.
export const METHOD_REACH: Record<
  RealmRunnerCallMethod,
  RealmRunnerMethodReach
> = {
  'fs.readText': 'realm-read',
  'fs.exists': 'realm-read',
  'fs.list': 'realm-read',
  'fs.replace': 'realm-write',
  'fs.writeText': 'realm-write',
  'fs.copy': 'realm-write',
  'fs.writeBytes': 'realm-write',
  'fs.download': 'web',
  'cards.search': 'realm-read',
  'cards.get': 'realm-read',
  'cards.update': 'realm-write',
  'operations.invoke': 'operation',
  'operations.invokeBatchOperation': 'operation',
  'operations.capabilities': 'realm-read',
  'entries.search': 'realm-read',
  'fs.delete': 'realm-delete',
  capture: 'capture',
  'images.generate': 'image',
  'workspaces.create': 'workspace',
  'workspaces.delete': 'workspace',
  'room.enableSkills': 'room',
  'room.disableSkills': 'room',
  'room.setModel': 'room',
  'room.credits': 'room',
  'ui.switchSubmode': 'ui',
  'ui.openFile': 'ui',
  'ui.previewFormat': 'ui',
  'ui.openWorkspace': 'ui',
  'index.invalidate': 'index',
  'index.reindex': 'index',
  'index.fullReindex': 'index',
  'index.cancelJob': 'index',
  'web.search': 'web',
  'web.read': 'web',
  resolve: 'model',
  transform: 'transform',
  activity: 'progress',
  plan: 'progress',
  ask: 'person',
  'progress.plan': 'progress',
  'progress.milestone': 'progress',
  'progress.count': 'progress',
  'console.log': 'log',
  'console.info': 'log',
  'console.warn': 'log',
  'console.error': 'log',
};

// The assistant's surface: everything but the automation run's own progress
// and console methods.
export const INTERACTIVE_METHODS: ReadonlySet<RealmRunnerCallMethod> =
  new Set<RealmRunnerCallMethod>([
    'fs.readText',
    'fs.exists',
    'fs.list',
    'fs.replace',
    'fs.writeText',
    'fs.copy',
    'fs.writeBytes',
    'fs.download',
    'cards.search',
    'cards.get',
    'cards.update',
    'operations.invoke',
    'operations.invokeBatchOperation',
    'operations.capabilities',
    'entries.search',
    'fs.delete',
    'capture',
    'images.generate',
    'workspaces.create',
    'workspaces.delete',
    'room.enableSkills',
    'room.disableSkills',
    'room.setModel',
    'room.credits',
    'ui.switchSubmode',
    'ui.openFile',
    'ui.previewFormat',
    'ui.openWorkspace',
    'index.invalidate',
    'index.reindex',
    'index.fullReindex',
    'index.cancelJob',
    'web.search',
    'web.read',
    'resolve',
    'transform',
    'activity',
    'plan',
    'ask',
  ]);

// An automation run's surface, an allowlist (ADR 025 §1.4): a method that is
// not here is refused. Adding a method here, or moving one between the two
// surfaces, is a reviewed change, and the allowlist test pins this list.
export const AUTOMATION_METHODS: ReadonlySet<RealmRunnerCallMethod> =
  new Set<RealmRunnerCallMethod>([
    'fs.readText',
    'fs.exists',
    'fs.list',
    'fs.replace',
    'fs.writeText',
    'fs.copy',
    'fs.writeBytes',
    'cards.search',
    'cards.get',
    'cards.update',
    'entries.search',
    'operations.invoke',
    'operations.invokeBatchOperation',
    'resolve',
    'activity',
    'progress.plan',
    'progress.milestone',
    'progress.count',
    'console.log',
    'console.info',
    'console.warn',
    'console.error',
  ]);

// Methods that answer nothing: the guest posts them and goes on, so a script
// needn't await them.
export const NOTIFY_METHODS: ReadonlySet<RealmRunnerCallMethod> =
  new Set<RealmRunnerCallMethod>([
    'progress.plan',
    'progress.milestone',
    'progress.count',
    'console.log',
    'console.info',
    'console.warn',
    'console.error',
  ]);

// The most milestones `realm.progress.plan` takes, and the longest name of
// one.
export const MAX_MILESTONES = 50;
export const MAX_MILESTONE_CHARS = 80;

export function surfaceMethods(
  surface: RealmRunnerSurface,
): ReadonlySet<RealmRunnerCallMethod> {
  return surface === 'automation' ? AUTOMATION_METHODS : INTERACTIVE_METHODS;
}

// Why a method is not on the surface, in the words the script reads.
export function offSurfaceMessage(
  surface: RealmRunnerSurface,
  method: RealmRunnerCallMethod,
): string {
  // `console` and `room` are globals of their own; the rest hang off `realm`.
  let name = /^(console|room)\./.test(method) ? method : `realm.${method}`;
  return surface === 'automation'
    ? `${name} is not available to an automation run`
    : `${name} is only available to an automation run`;
}
