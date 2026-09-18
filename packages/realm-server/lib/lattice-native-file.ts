import { createHash } from 'node:crypto';
import { analyzeLatticeGtsSource } from '@cardstack/runtime-common/lattice-gts-analysis';
import type { CodeRef } from '@cardstack/runtime-common';
import {
  baseFileData,
  codeFileData,
  jsonFileData,
} from '@cardstack/runtime-common/base-file-data';
import { buildFileResource } from '@cardstack/runtime-common/file-resource';
import type {
  LatticeNativeCardIndexRequest,
  LatticeNativeCardIndexResult,
  LatticeNativeFileIndexer,
  LatticeNativeFileIndexRequest,
} from '@cardstack/runtime-common/lattice-native-index';
import type { LatticeNativeCardAdmission } from './lattice-native-card-indexer.ts';
import type { LatticeDefinitionSnapshot } from './lattice-card-data.ts';
import type { LatticeJsonSourceFingerprint } from '@cardstack/runtime-common/lattice-json-source';

// An operator-reviewed binding to the shared base JSON extractor. Merely
// exporting a FileDef or an SVG is not permission to replace custom code.
export interface LatticeNativeFileAdmission {
  kind: 'base-json' | 'base-gts';
  snapshot: LatticeDefinitionSnapshot;
  deps: string[];
  contentHash: string;
  contentSize: number;
}

export async function extractLatticeJsonFile(
  request: LatticeNativeCardIndexRequest,
  admission: LatticeNativeFileAdmission,
  typeKey: (ref: CodeRef) => string,
  sourceFingerprint?: LatticeJsonSourceFingerprint,
): Promise<NonNullable<LatticeNativeCardIndexResult['file']>> {
  const metadata = admission.snapshot.definition.nativeFileIndex;
  if (
    admission.kind !== 'base-json' ||
    !metadata?.types.length ||
    !metadata.displayNames.length ||
    !metadata.staticIcon?.svg ||
    !admission.deps.length
  )
    throw new Error('Incomplete native file admission');
  const base = await baseFileData(
    request.url,
    async () => new TextEncoder().encode(request.sourceJSON),
    admission,
  );
  const searchDoc = { ...base, ...jsonFileData(request.sourceJSON, base.name) };
  const resource = buildFileResource(
    request.url,
    searchDoc,
    metadata.types[0],
    undefined,
    undefined,
    {
      lastModified: request.lastModified,
      createdAt: request.resourceCreatedAt,
    },
  );
  if (sourceFingerprint) resource.meta.latticeSource = sourceFingerprint;
  return {
    extract: {
      id: request.url,
      nonce: 'native',
      status: 'ready',
      resource,
      searchDoc,
      types: metadata.types.map(typeKey),
      displayNames: [...metadata.displayNames],
      staticIcon: metadata.staticIcon,
      deps: [...admission.deps],
    },
    render: {
      isolatedHTML: null,
      headHTML: null,
      atomHTML: null,
      embeddedHTML: null,
      fittedHTML: null,
      markdown: null,
      iconHTML: metadata.staticIcon.svg,
    },
  };
}

// An independently reviewed FileDef producer. No card module is loaded, and
// the source file need not itself have a successfully indexed module entry.
export function createLatticeNativeFileIndexer({
  admit,
}: {
  admit(
    request: LatticeNativeFileIndexRequest,
  ): Promise<LatticeNativeCardAdmission | undefined>;
}): LatticeNativeFileIndexer {
  return async (request) => {
    const started = performance.now();
    const admission = await admit(request);
    if (!admission?.file) return undefined;
    const prepared = performance.now();
    const file = admission.file;
    const metadata = file.snapshot.definition.nativeFileIndex;
    if (file.kind !== 'base-gts' || !request.url.endsWith('.gts'))
      return undefined;
    if (
      !metadata?.types.length ||
      !metadata.displayNames.length ||
      !file.deps.length
    )
      throw new Error('Incomplete native GTS file admission');
    const base = await baseFileData(
      request.url,
      async () => new TextEncoder().encode(request.source),
      file,
    );
    const analysis = analyzeLatticeGtsSource(request.url, request.source);
    const searchDoc = {
      ...base,
      ...codeFileData(request.source, base.name),
      latticeAnalysisStatus: analysis.state,
      latticeAnalysis: null,
    };
    const resource = buildFileResource(
      request.url,
      searchDoc,
      metadata.types[0],
      undefined,
      undefined,
      {
        lastModified: request.lastModified,
        createdAt: request.resourceCreatedAt,
      },
    );
    resource.attributes = { ...resource.attributes, latticeAnalysis: analysis };
    const { source, ...requestIdentity } = request;
    const receipt = {
      request: requestIdentity,
      sourceHash: createHash('sha256').update(source).digest('hex'),
      runtimeRevision: admission.runtimeRevision,
      definitions: [
        {
          codeRef: file.snapshot.definition.codeRef,
          revision: file.snapshot.revision,
        },
      ],
    };
    return {
      extract: {
        id: request.url,
        nonce: 'native',
        status: 'ready',
        resource,
        searchDoc,
        types: metadata.types.map(admission.typeKey),
        displayNames: [...metadata.displayNames],
        deps: [...file.deps],
        ...(metadata.staticIcon ? { staticIcon: metadata.staticIcon } : {}),
      },
      ...(metadata.staticIcon?.svg
        ? {
            render: {
              isolatedHTML: null,
              headHTML: null,
              atomHTML: null,
              embeddedHTML: null,
              fittedHTML: null,
              markdown: null,
              iconHTML: metadata.staticIcon.svg,
            },
          }
        : {}),
      timings: {
        admission: prepared - started,
        computeAndAssemble: performance.now() - prepared,
      },
      assertCurrent: nativeFilePublicationCheck(
        admission.assertCurrent,
        receipt,
      ),
    };
  };
}

// Keep only compact revision facts alive until Batch.done. Capturing admission
// here would retain its definition/lookup graphs for every indexed source file.
function nativeFilePublicationCheck(
  check: LatticeNativeCardAdmission['assertCurrent'],
  receipt: Parameters<LatticeNativeCardAdmission['assertCurrent']>[1],
) {
  return (tx: Parameters<LatticeNativeCardAdmission['assertCurrent']>[0]) =>
    check(tx, receipt);
}
