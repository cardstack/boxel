import { capturesMetaFromManifest } from '../capture-spec.ts';
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
  type OperationRowHeaders,
  type OperationRequest,
} from './types.ts';
import type {
  OperationCore,
  OperationScope,
  RunOperationOptions,
} from './dispatch.ts';
import type { LocalPath } from '../paths.ts';
import type { SingleFileMetaDocument } from '../document-types.ts';
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
//   * headers  — the values the card+json response headers are computed from,
//                reached by a row peek. No card document is assembled and no
//                link is expanded, because the caller is answering a HEAD or a
//                conditional GET and would throw the body away.
//
// Both modes ask the same question in the same order — is there an instance
// row for this URL, and failing that does the path hold bytes — so the two can
// never disagree about what a path is. What separates them is how much they
// then read, not what they decide.
//
// The document mode's *body* is held to byte-for-byte agreement with what the
// card+json GET handler serves: the same canonical URL, the same `links.self`,
// the same prefix-form ids, the same freshly-joined `meta.generation` and
// `meta.captures`, the same disk-read file-meta document for a path that
// holds bytes, and the same mapping from an errored index row to an HTTP
// status.
//
// The body, and not the response around it. Two things stay the handler's, and
// a caller that is not it has to account for them:
//
//   * It drains in-flight incremental indexing before reading, so a read here
//     serves whatever the index currently holds rather than waiting for a
//     write that has landed on disk to be indexed.
//   * It answers the redirects, and for the `.json` spelling it redirects to
//     the card. A read has no redirect to give, and a `.json` names a card's
//     stored source rather than the card: no instance row answers to that
//     spelling and the bytes behind it are a card's source rather than a
//     file's, so a read of one finds nothing. The two diverge there by intent
//     rather than by omission. A path that merely normalizes to a different
//     one is served, not redirected.
//
// What the handler does not have to reconstruct is the row behind the answer.
// Both modes report it: the headers mode is nothing else, and the document
// mode carries it alongside the body, read off the same assembly the body came
// from. That is what lets one read produce both a document and a validator
// that describes it, instead of a second peek that a write can land inside of.
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

// A declaration may specialize `read` by running a `program` over the target,
// and a declaration rebound onto `read` may carry a clause that belongs to the
// base it came from. Neither is carried out here, and serving the plain
// document as though the declaration said nothing hands the caller a
// well-formed answer to a different question. Refusing says so.
//
// The two transform stages are not on this list: `runOperation` runs them
// around every executor, so a `read` specialized with `input` or `output` is
// carried out rather than refused.
function refuseUnservedStages(
  request: OperationRequest,
  definition: OperationDefinition,
): void {
  let stages = (['program', 'fill', 'items', 'of', 'query'] as const).filter(
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
  // The index decides first, and the bytes on disk are the fallback — not the
  // other way round. Classifying by the URL's extension before asking would be
  // cheaper, and would be wrong for a card whose id happens to end in a
  // registered one: the card has an index row, and reading its extension
  // instead answers about a file that is not there.
  let result = await core.indexQueryEngine.cardDocument(url, {
    loadLinks: true,
    skipQueryBackedExpansion: opts.skipQueryBackedExpansion ?? false,
    resolveLinksOnly: opts.resolveLinksOnly ?? false,
    skipLinkAssemblyBudget: opts.skipLinkAssemblyBudget ?? false,
  });
  if (result === undefined) {
    // A path with no instance row may still hold bytes: a file asked for as
    // card+json answers with its metadata document rather than its content, so
    // the caller receives JSON it can discriminate on `data.type`.
    let fileMeta = await core.fileMetaDocument(localPath);
    if (fileMeta) {
      return fileMetaResult(fileMeta);
    }
    throw await missingTarget(core, url, localPath);
  }
  if (result.type === 'error') {
    throw errorRowFailure(url, result);
  }
  let { doc } = result;
  doc.data.links = { self: url.href };
  core.unresolveInstanceIds(doc);
  // The index-data generation, the source version and the declared-capture
  // manifest are joined at serve time onto a fresh `meta` — never a mutation of
  // the cached pristine doc's own. The generation lets a consumer tell fresh
  // index data from stale; the manifest is never written back into the index row
  // or the source file.
  //
  // `version` is the content hash of the stored source this document was
  // assembled from, recorded on the row by the pass that indexed those bytes. A
  // client sends it back as the base its next write is computed against, so it
  // has to describe the document it ships with and not the file's current
  // state — which is why it is read off the row here rather than from
  // `realm_file_meta` at serve time. Omitted entirely when the row carries none,
  // so a caller reads "no version" rather than a value it cannot rely on.
  //
  // It travels with the response only. Both strips that stand between a client
  // echoing a document back and the bytes on disk — `file-serializer.ts` and
  // `stageUpdate` — drop it, so a version is never persisted into the very file
  // it describes.
  doc.data.meta = {
    ...doc.data.meta,
    generation: result.generation,
    ...(result.version != null ? { version: result.version } : {}),
    ...(result.captures
      ? {
          captures: capturesMetaFromManifest(result.captures, {
            realmURL: core.realmURL,
            instanceLocalPath: localPath,
          }),
        }
      : {}),
  };
  return {
    document: doc,
    // The assembled document, unprojected. `runOperation` runs the `output`
    // stage over what this returns and reports the projection there, so that
    // one place decides what a caller is served whichever executor produced
    // it.
    projected: false,
    // Read off the assembly rather than off a peek taken before it: the two
    // can disagree when a write lands in between, and the validator a caller
    // builds from this has to describe the document it is returned with.
    headers: {
      type: 'card',
      indexedAt: result.indexedAt,
      lastModified: numberOrNull(doc.data.meta.lastModified),
      generation: result.generation,
      captures: result.captures,
      deps: result.deps,
    },
    queryBacked: result.queryBacked,
  };
}

// A file's metadata document, and what it can say about its own headers.
function fileMetaResult(
  document: SingleFileMetaDocument,
): OperationDocumentResult {
  return {
    document,
    projected: false,
    headers: headersFromDisk(document),
    // Derived from the bytes on disk, so there is no query behind it.
    queryBacked: false,
  };
}

// The peek, and nothing else. `cardDocument` is deliberately not reached here:
// it expands links, and a caller computing headers pays for a body it discards.
async function readHeaders(
  core: OperationCore,
  url: URL,
  localPath: LocalPath,
  scope: OperationScope,
): Promise<OperationHeadResult> {
  let row = await scope.peekInstance(url);
  if (row === undefined) {
    // No instance row, so the path may hold bytes instead. The indexed file
    // row answers that without touching the disk; a file the realm serves but
    // has not indexed still has a modification time to report, and a file
    // whose extension is not a registered one never gets a row at all, so the
    // disk is the fallback behind it.
    let file = await core.indexQueryEngine.file(url);
    if (file) {
      return {
        projected: false,
        type: 'file-meta',
        indexedAt: file.indexedAt,
        lastModified: file.lastModified,
        generation: file.generation,
        captures: file.captures,
        deps: file.deps,
      };
    }
    let fileMeta = await core.fileMetaDocument(localPath);
    if (fileMeta) {
      return { projected: false, ...headersFromDisk(fileMeta) };
    }
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
    projected: false,
    type: 'card',
    indexedAt: row.indexedAt,
    lastModified: row.lastModified,
    generation: row.generation,
    captures: row.captures,
    deps: row.deps,
  };
}

// What a file's own metadata can say about its headers. There is no index row
// behind these, so the values a row would carry are absent rather than guessed.
function headersFromDisk(
  document: SingleFileMetaDocument,
): OperationRowHeaders {
  return {
    type: 'file-meta',
    indexedAt: null,
    lastModified: numberOrNull(document.data.attributes?.lastModified),
    generation: null,
    captures: null,
    deps: null,
  };
}

// The errored index row behind a `target-errored` refusal, exactly as the row
// itself reported it. The refusal's own `status`, `title` and `detail` are
// computed from these — the status mapped to one the realm serves, the detail
// rendered into a sentence naming the URL the read resolved — so a surface
// that builds its own error body reads the row rather than picking those
// apart. The salvage a client shows in place of the card it could not get
// travels here too.
export interface ErroredTargetRow {
  status: number;
  title: string | undefined;
  message: string;
  stack: string | undefined;
  lastKnownGoodHtml: string | null;
  cardTitle: string | null;
  scopedCssUrls: string[];
}

export function erroredTargetRow(
  failure: OperationFailure,
): ErroredTargetRow | undefined {
  let row = failure.error.meta?.[ERRORED_ROW];
  return row === undefined ? undefined : (row as ErroredTargetRow);
}

const ERRORED_ROW = 'erroredRow';

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
  let row: ErroredTargetRow = {
    status: errorDetail.status,
    title: errorDetail.title,
    message: errorDetail.message,
    stack: errorDetail.stack,
    lastKnownGoodHtml: result.error.lastKnownGoodHtml,
    cardTitle: result.error.cardTitle,
    scopedCssUrls: result.error.scopedCssUrls,
  };
  return new OperationFailure({
    id: url.href,
    status,
    code: 'target-errored',
    title: errorDetail.title ?? 'Error',
    detail: `cannot read ${url.href} from index: ${errorDetail.title} - ${errorDetail.message}`,
    meta: { [ERRORED_ROW]: row },
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
  let source = await core.readFileAsText(sourcePath);
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
