import { screenshotsMetaFromManifest } from '../capture-spec.ts';
import { urlNamesFile } from '../file-def-code-ref.ts';
import { isSingleCardDocument } from '../document-types.ts';
import {
  canonicalizeTarget,
  instanceTargetURL,
  localPathFor,
  newOperationScope,
  pathsFor,
} from './dispatch.ts';
import {
  OperationFailure,
  type OperationDefinition,
  type OperationDocumentResult,
  type OperationHeadResult,
  type OperationRequest,
} from './types.ts';
import type {
  OperationCore,
  OperationScope,
  RunOperationOptions,
} from './dispatch.ts';
import type { LocalPath } from '../paths.ts';
import type { SearchResultError } from '../realm-index-query-engine.ts';

// ============================================================================
// The `read` executor.
//
// A read serves the realm's indexed view of a target: the same JSON:API
// document the card+json GET returns, assembled from the search index without
// instantiating the card. Two modes, and the difference between them is the
// point of having two:
//
//   * document — the full body, link expansion included.
//   * headers  — the four values the card+json response headers are computed
//                from, via the index-row peek alone. No card document is
//                assembled and no link is expanded, because the caller is
//                answering a HEAD or a conditional GET and would throw the
//                body away.
//
// The document mode's *body* is held to byte-for-byte agreement with what the
// card+json GET handler serves: the same canonical URL, the same `links.self`,
// the same prefix-form ids, the same freshly-joined `meta.generation` and
// `meta.screenshots`, the same disk-read file-meta document for a path that
// holds bytes, and the same mapping from an errored index row to an HTTP
// status.
//
// The body, and not the response around it. Three things stay the handler's,
// and a caller that is not it has to account for them:
//
//   * It drains in-flight incremental indexing before reading, so a read here
//     serves whatever the index currently holds rather than waiting for a
//     write that has landed on disk to be indexed.
//   * It answers the redirects, and for the `.json` spelling it redirects to
//     the card. A read has no redirect to give, and treats that spelling as
//     what it literally names — the card's stored source, a file-def target —
//     so the two diverge there by intent rather than by omission. A path that
//     merely normalizes to a different one is served, not redirected.
//   * It computes the 200's validator from the assembled document's own
//     `deps` / `indexedAt` / `screenshots`, which this result does not carry —
//     only the headers mode reports those. A caller wanting both a body and an
//     ETag needs them threaded through, or it re-peeks and takes on the
//     snapshot skew the handler avoids by reading them off the assembly.
// ============================================================================

export async function readOperation(
  core: OperationCore,
  request: OperationRequest,
  definition: OperationDefinition,
  opts: RunOperationOptions = {},
  scope: OperationScope = newOperationScope(core),
): Promise<OperationDocumentResult | OperationHeadResult> {
  // `runOperation` canonicalized the target already; doing it again is a no-op
  // and keeps a direct caller of this executor addressing the same card
  // dispatch would have.
  let target = canonicalizeTarget(core, request.target);
  let url = instanceTargetURL({ ...request, target });
  refuseUnservedStages(request, definition);
  let localPath = localPathFor(core, url);
  if (opts.headersOnly) {
    return await readHeaders(core, url, localPath, scope);
  }
  return await readDocument(core, url, localPath, opts);
}

// A declaration may specialize `read` — reshaping the payload with `input`,
// projecting the result with `output`, running a `program`. None of that is
// carried out here, and serving the plain document as though the declaration
// said nothing hands the caller a well-formed answer to a different question.
// Refusing says so.
function refuseUnservedStages(
  request: OperationRequest,
  definition: OperationDefinition,
): void {
  let stages = (['program', 'input', 'output'] as const).filter(
    (stage) => definition[stage] !== undefined,
  );
  if (stages.length === 0) {
    return;
  }
  throw new OperationFailure({
    id: request.target.kind === 'instance' ? request.target.url : undefined,
    status: 501,
    code: 'internal-error',
    title: 'Operation not implemented',
    detail:
      `operation "${request.name}" specializes \`read\` with ` +
      `${stages.join(', ')}, which the read executor does not carry out`,
  });
}

async function readDocument(
  core: OperationCore,
  url: URL,
  localPath: LocalPath,
  opts: RunOperationOptions,
): Promise<OperationDocumentResult> {
  if (urlNamesFile(url)) {
    return { document: await fileMetaOrMissing(core, url, localPath) };
  }
  let result = await core.indexQueryEngine.cardDocument(url, {
    loadLinks: true,
    skipQueryBackedExpansion: opts.skipQueryBackedExpansion ?? false,
  });
  if (result === undefined) {
    // A path with no instance row may still hold bytes: a file asked for as
    // card+json answers with its metadata document rather than its content, so
    // the caller receives JSON it can discriminate on `data.type`.
    let fileMeta = await core.fileMetaDocument(localPath);
    if (fileMeta) {
      return { document: fileMeta };
    }
    throw await missingTarget(core, url, localPath);
  }
  if (result.type === 'error') {
    throw errorRowFailure(url, result);
  }
  let { doc } = result;
  doc.data.links = { self: url.href };
  core.unresolveInstanceIds(doc);
  // The index-data generation and the declared-screenshot manifest are joined
  // at serve time onto a fresh `meta` — never a mutation of the cached
  // pristine doc's own. The generation lets a consumer tell fresh index data
  // from stale; the manifest is never written back into the index row or the
  // source file.
  doc.data.meta = {
    ...doc.data.meta,
    generation: result.generation,
    ...(result.screenshots
      ? {
          screenshots: screenshotsMetaFromManifest(result.screenshots, {
            realmURL: core.realmURL,
            instanceLocalPath: localPath,
          }),
        }
      : {}),
  };
  return { document: doc };
}

// The peek, and nothing else. `cardDocument` is deliberately not reached here:
// it expands links, and a caller computing headers pays for a body it discards.
async function readHeaders(
  core: OperationCore,
  url: URL,
  localPath: LocalPath,
  scope: OperationScope,
): Promise<OperationHeadResult> {
  if (urlNamesFile(url)) {
    let file = await core.indexQueryEngine.file(url);
    if (!file) {
      // Fall back to the bytes on disk the same way the document mode does —
      // a file the realm serves but has not indexed still has a modification
      // time to report.
      let fileMeta = await fileMetaOrMissing(core, url, localPath);
      let attributes = fileMeta.data.attributes;
      return {
        indexedAt: null,
        lastModified: numberOrNull(attributes?.lastModified),
        generation: null,
        screenshots: null,
        deps: null,
      };
    }
    return {
      indexedAt: file.indexedAt,
      lastModified: file.lastModified,
      generation: file.generation,
      screenshots: file.screenshots,
      deps: file.deps,
    };
  }
  let row = await scope.peekInstance(url);
  if (row === undefined) {
    throw await missingTarget(core, url, localPath);
  }
  if (row.type !== 'instance') {
    // Only the status is wanted here, and that comes from the error alone. The
    // salvage the assembled document's error result carries — the last known
    // good rendering, its scoped CSS, the card's title — is reachable from
    // this same row, so a caller that needs it (a conditional GET falling
    // through to a body) must assemble the document rather than read it off
    // this refusal.
    throw errorRowFailure(url, {
      type: 'error',
      error: {
        errorDetail: row.error,
        scopedCssUrls: [],
        lastKnownGoodHtml: null,
        cardTitle: null,
      },
    });
  }
  return {
    indexedAt: row.indexedAt,
    lastModified: row.lastModified,
    generation: row.generation,
    screenshots: row.screenshots,
    deps: row.deps,
  };
}

async function fileMetaOrMissing(
  core: OperationCore,
  url: URL,
  localPath: LocalPath,
) {
  let document = await core.fileMetaDocument(localPath);
  if (!document) {
    throw await missingTarget(core, url, localPath);
  }
  return document;
}

// The index has a row for this card, it just cannot be served cleanly, so the
// underlying error's own HTTP status carries through when it is a real one —
// auth, validation, an upstream 5xx — instead of everything flattening to 500.
//
// 404 is the one status never mirrored: an existing-but-errored card is not
// "not found". That code is reserved for a missing index row, so that a 404
// from a read is an unambiguous "this card no longer exists". A recorded 404
// (an error whose cause was a missing linked instance, say) therefore falls
// back to 500, as do non-HTTP failures recorded as status 0 and any
// out-of-range value.
function errorRowFailure(
  url: URL,
  result: SearchResultError,
): OperationFailure {
  let { errorDetail } = result.error;
  let status =
    errorDetail.status >= 400 &&
    errorDetail.status <= 599 &&
    errorDetail.status !== 404
      ? errorDetail.status
      : 500;
  return new OperationFailure({
    id: url.href,
    status,
    code: 'target-errored',
    title: errorDetail.title ?? 'Error',
    detail: `cannot read ${url.href} from index: ${errorDetail.title} - ${errorDetail.message}`,
    meta: {
      lastKnownGoodHtml: result.error.lastKnownGoodHtml,
      cardTitle: result.error.cardTitle,
      scopedCssUrls: result.error.scopedCssUrls,
      stack: errorDetail.stack,
    },
  });
}

// No index row, so there is no document to serve. Which absence this is
// depends on the source file: a write lands on the realm's file system first
// and is indexed after, so a card whose `.json` is already on disk is one this
// realm has not caught up with rather than one that does not exist. Saying so
// lets a caller hold a placeholder until the realm broadcasts the index event
// for it, instead of concluding the card is gone.
async function missingTarget(
  core: OperationCore,
  url: URL,
  localPath: LocalPath,
): Promise<OperationFailure> {
  let notFound = new OperationFailure({
    id: url.href,
    status: 404,
    code: 'target-not-found',
    title: 'Not found',
    detail: `${url.href} does not exist in realm ${core.realmURL}`,
  });
  let sourcePath = `${localPath}.json` as LocalPath;
  // An ignored path is never visited, so no amount of waiting produces an
  // index row for it.
  if (await core.isIgnored(pathsFor(core).fileURL(sourcePath))) {
    return notFound;
  }
  let source = await core.readSource(sourcePath);
  if (source === undefined) {
    return notFound;
  }
  // The promise that a row is coming has to match what the indexer will
  // actually make one for: a `.json` whose `data` is a single card resource. A
  // collection document never becomes an instance row, and neither does
  // anything else — those are genuinely not cards, not cards in waiting.
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return notFound;
  }
  if (!isSingleCardDocument(parsed)) {
    return notFound;
  }
  return new OperationFailure({
    id: url.href,
    status: 404,
    code: 'target-not-indexed',
    title: 'Not indexed yet',
    detail: `${url.href} has not finished indexing`,
    meta: { awaitingIndex: true },
  });
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
