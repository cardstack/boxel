import { createHash } from 'node:crypto';
import { realmRRI } from './rri.ts';

export const REPOSITORY_SPEC = 'deck-repository-v2';
export const REPOSITORY_MANIFEST_SPEC = 'deck-repository-manifest-v2';
export const CHECKPOINT_SPEC = 'deck-checkpoint-v2';

const HASH = /^[0-9a-f]{64}$/;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Repository {
  schema: typeof REPOSITORY_SPEC;
  roots: string[];
  members: Record<string, string>;
  lockHash: string;
}

export interface RepositoryManifest {
  schema: typeof REPOSITORY_MANIFEST_SPEC;
  roots: string[];
  members: Record<string, string>;
}

export interface Actor {
  id: string;
  name?: string;
}

export interface Checkpoint {
  schema: typeof CHECKPOINT_SPEC;
  repositoryHash: string;
  parents: string[];
  historyHead: string;
  indexGenerationHash: string;
  author: Actor;
  message: string;
  createdAt: string;
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function normalizedJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => byteOrder(a, b))
        .map(([key, member]) => [key, normalizedJson(member)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('canonical JSON cannot contain a non-finite number');
  }
  return value;
}

export function canonicalJson(value: JsonValue): Buffer {
  return Buffer.from(JSON.stringify(normalizedJson(value), null, 2) + '\n');
}

export function hashProtocolObject(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function isHash(value: string): boolean {
  return HASH.test(value);
}

function sortedUniqueRRIs(values: string[], label: string): string[] {
  let normalized = values.map(realmRRI).sort(byteOrder);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  return normalized;
}

function validatedActor(value: Actor, label: string): Actor {
  if (value.id.trim() === '') throw new Error(`${label} id must not be empty`);
  return { id: value.id, ...(value.name ? { name: value.name } : {}) };
}

export function canonicalInstant(createdAt: string): string {
  let instant = new Date(createdAt);
  if (!Number.isFinite(instant.valueOf()) || instant.toISOString() !== createdAt) {
    throw new Error('createdAt must be a canonical UTC ISO-8601 timestamp');
  }
  return createdAt;
}

function localAuthoringPath(value: string): string {
  if (value === '.') return value;
  if (
    value === '' ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`invalid repository authoring path: ${JSON.stringify(value)}`);
  }
  return value;
}

export function repositoryManifest(options: {
  roots: string[];
  members: Record<string, string>;
}): RepositoryManifest {
  let entries = Object.entries(options.members)
    .map(([member, path]) => [realmRRI(member), localAuthoringPath(path)] as const)
    .sort(([a], [b]) => byteOrder(a, b));
  if (entries.length === 0) {
    throw new Error('a repository must contain at least one member package');
  }
  if (new Set(entries.map(([member]) => member)).size !== entries.length) {
    throw new Error('repository members must not contain duplicates');
  }
  let members = Object.fromEntries(entries);
  let roots = sortedUniqueRRIs(options.roots, 'repository roots');
  for (let root of roots) {
    if (!(root in members)) {
      throw new Error(`repository root is not a member: ${JSON.stringify(root)}`);
    }
  }
  return { schema: REPOSITORY_MANIFEST_SPEC, roots, members };
}

export function repository(options: {
  roots: string[];
  members: Record<string, string>;
  lockHash: string;
}): Repository {
  let entries = Object.entries(options.members)
    .map(([member, treeHash]) => {
      let id = realmRRI(member);
      if (!isHash(treeHash)) {
        throw new Error(`invalid treeHash for ${id}: ${JSON.stringify(treeHash)}`);
      }
      return [id, treeHash] as const;
    })
    .sort(([a], [b]) => byteOrder(a, b));
  if (entries.length === 0) {
    throw new Error('a repository must contain at least one member package');
  }
  let members = Object.fromEntries(entries);
  let roots = sortedUniqueRRIs(options.roots, 'repository roots');
  for (let root of roots) {
    if (!(root in members)) {
      throw new Error(`repository root is not a member: ${JSON.stringify(root)}`);
    }
  }
  if (!isHash(options.lockHash)) {
    throw new Error(`invalid lockHash: ${JSON.stringify(options.lockHash)}`);
  }
  return { schema: REPOSITORY_SPEC, roots, members, lockHash: options.lockHash };
}

export function repositoryHash(value: Repository): string {
  return hashProtocolObject(value as unknown as JsonValue);
}

export function checkpoint(options: {
  repositoryHash: string;
  parents?: string[];
  historyHead: string;
  indexGenerationHash: string;
  author: Actor;
  message: string;
  createdAt: string;
}): Checkpoint {
  if (!isHash(options.repositoryHash)) throw new Error('invalid Repository hash');
  let parents = [...(options.parents ?? [])];
  if (new Set(parents).size !== parents.length || parents.some((value) => !isHash(value))) {
    throw new Error('Checkpoint parents must be unique Checkpoint hashes');
  }
  if (options.historyHead.trim() === '') throw new Error('historyHead must not be empty');
  if (!isHash(options.indexGenerationHash)) throw new Error('invalid index generation hash');
  if (options.message.trim() === '') throw new Error('Checkpoint message must not be empty');
  return {
    schema: CHECKPOINT_SPEC,
    repositoryHash: options.repositoryHash,
    parents,
    historyHead: options.historyHead,
    indexGenerationHash: options.indexGenerationHash,
    author: validatedActor(options.author, 'Checkpoint author'),
    message: options.message,
    createdAt: canonicalInstant(options.createdAt),
  };
}

export function checkpointHash(value: Checkpoint): string {
  return hashProtocolObject(value as unknown as JsonValue);
}

export function changedMembers(before: Repository, after: Repository): string[] {
  return [...new Set([...Object.keys(before.members), ...Object.keys(after.members)])]
    .filter((member) => before.members[member] !== after.members[member])
    .sort(byteOrder);
}
