import type { LooseSingleCardDocument } from './index.ts';
import { latticeSnapshotFields } from './lattice-materialization.ts';

// A producer input, not authored card source or evidence that the current realm
// still matches it. Publication must separately recheck authority at commit.
export interface LatticeRenderCheckpoint {
  version: 1;
  id: string;
  realmURL: string;
  loaderEpoch?: string;
  documentHash: string;
  document: LooseSingleCardDocument;
}

export interface LatticeRenderReceipt {
  version: 1;
  id: string;
  realmURL: string;
  documentHash: string;
  publishedGeneration: number;
  definitionRevision: string;
  loaderEpoch?: string;
}

export function currentLatticeRenderCheckpoint():
  | LatticeRenderCheckpoint
  | undefined {
  let globals = globalThis as unknown as {
    __boxelRenderContext?: boolean;
    __latticeRenderCheckpoint?: LatticeRenderCheckpoint;
  };
  return globals.__boxelRenderContext === true
    ? globals.__latticeRenderCheckpoint
    : undefined;
}

async function documentHash(document: LooseSingleCardDocument) {
  let text = JSON.stringify(document);
  // Bounded producer input; ordinary readers never perform this work.
  if (text.length > 8 * 1024 * 1024) {
    throw new Error('Lattice render checkpoint exceeds its byte limit');
  }
  let bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > 8 * 1024 * 1024) {
    throw new Error('Lattice render checkpoint exceeds its byte limit');
  }
  let digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export async function createLatticeRenderCheckpoint(
  document: LooseSingleCardDocument,
  realmURL: string,
  loaderEpoch = document.data.meta?.publication?.definitionRevision,
): Promise<LatticeRenderCheckpoint> {
  let checkpoint: LatticeRenderCheckpoint = {
    version: 1,
    id: document.data.id!,
    realmURL,
    ...(loaderEpoch !== document.data.meta?.publication?.definitionRevision
      ? { loaderEpoch }
      : {}),
    documentHash: await documentHash(document),
    document,
  };
  await validateLatticeRenderCheckpoint(checkpoint, {
    id: checkpoint.id,
    realmURL,
    loaderEpoch,
  });
  return checkpoint;
}

export async function validateLatticeRenderCheckpoint(
  checkpoint: LatticeRenderCheckpoint,
  expected: { id: string; realmURL?: string; loaderEpoch?: string },
): Promise<LatticeRenderReceipt> {
  if (
    !checkpoint ||
    typeof checkpoint !== 'object' ||
    typeof expected.id !== 'string'
  ) {
    throw new Error('Invalid Lattice render checkpoint');
  }
  let id = expected.id.replace(/\.json$/, '');
  let realm: URL, owner: URL;
  try {
    realm = new URL(checkpoint.realmURL);
    owner = new URL(id);
  } catch {
    throw new Error('Invalid Lattice render checkpoint URL');
  }
  if (
    checkpoint.version !== 1 ||
    checkpoint.id !== id ||
    checkpoint.document?.data?.id !== id ||
    checkpoint.document.data.type !== 'card' ||
    !checkpoint.document.data.meta ||
    (checkpoint.document.data.meta.realmURL !== undefined &&
      checkpoint.document.data.meta.realmURL !== checkpoint.realmURL) ||
    (expected.realmURL !== undefined &&
      checkpoint.realmURL !== expected.realmURL) ||
    !['http:', 'https:'].includes(realm.protocol) ||
    realm.origin !== owner.origin ||
    !realm.pathname.endsWith('/') ||
    !owner.pathname.startsWith(realm.pathname) ||
    realm.search ||
    realm.hash ||
    owner.search ||
    owner.hash ||
    realm.username ||
    realm.password ||
    owner.username ||
    owner.password
  ) {
    throw new Error(
      'Lattice render checkpoint does not match its owner and realm',
    );
  }
  let resource = checkpoint.document.data;
  if (!latticeSnapshotFields(resource)) {
    throw new Error('Lattice HTML requires a published materialization');
  }
  let publication = resource.meta.publication!;
  if (
    !expected.loaderEpoch ||
    (checkpoint.loaderEpoch ?? publication.definitionRevision) !==
      expected.loaderEpoch
  ) {
    throw new Error(
      'Lattice render checkpoint does not match the loaded definition epoch',
    );
  }
  if (checkpoint.documentHash !== (await documentHash(checkpoint.document))) {
    throw new Error('Lattice render checkpoint document digest mismatch');
  }
  return {
    version: 1,
    id,
    realmURL: realm.href,
    documentHash: checkpoint.documentHash,
    publishedGeneration: publication.outputRevision!,
    definitionRevision: publication.definitionRevision!,
    ...(checkpoint.loaderEpoch ? { loaderEpoch: checkpoint.loaderEpoch } : {}),
  };
}
