import { inferContentType } from '../infer-content-type.ts';
import {
  canonicalizeTarget,
  instanceTargetURL,
  localPathFor,
} from './dispatch.ts';
import {
  OperationFailure,
  type OperationRequest,
  type OperationSourceResult,
} from './types.ts';
import type { OperationCore, RunOperationOptions } from './dispatch.ts';

// ============================================================================
// The `readSource` executor.
//
// A stored-bytes read serves a resource exactly as it sits on disk: a card
// instance's `.json`, a `.gts` or `.ts` module's text, an image's or a PDF's
// bytes. It is the third of the realm's three reads — the document one is
// `read`, assembled from the search index; this one is the representation the
// realm's two byte routes serve, the `card+source` `GET`/`HEAD` and the raw
// byte serve.
//
// Two things separate it from `read`, and both come from what it serves:
//
//   * It consults no definition. `read` needs a type's definition to assemble
//     a document; bytes need only a path. A module has no `adoptsFrom` and no
//     definition-cache entry, so gating its source on a lookup would refuse a
//     read of bytes that are plainly there. Dispatch resolves the name before
//     it would reach one, and this executor asks for none.
//
//   * It touches the index not at all. There is no row to peek and no
//     generation to join on, so a `readSource` costs one file open and one
//     file-meta row — never a search read. That is also why it can answer for
//     a path the index has no row for, and for one it never will.
//
// Two modes, as `read` has:
//
//   * bytes   — the metadata plus `body`.
//   * headers — the same metadata with no `body`, for a `HEAD` or for a
//               conditional `GET` deciding on a validator. It leaves the
//               adapter's `content` untouched rather than reading and
//               discarding it, which matters concretely: `content` is a lazy
//               getter that opens a real stream on first touch, so touching it
//               to throw it away would strand one.
//
// What stays outside, and what a facade routing here has to keep:
//
//   * The redirects. An extension-less URL naming `foo.gts`, or a card id
//     naming its `.json`, is resolved by the facade — this executor takes the
//     resolved path and reads it. A read has no redirect to give.
//   * The response around the bytes. The `ETag` built from `version` and its
//     source variant, `Last-Modified`, `x-created`, the 304, `Range` and the
//     source cache are all the facade's, computed from what comes back here.
//   * A batching envelope over operations does not carry this one at all:
//     bytes do not belong in a JSON batch, and a stream cannot be one member
//     of one.
// ============================================================================

export async function readSourceOperation(
  core: OperationCore,
  request: OperationRequest,
  opts: RunOperationOptions = {},
): Promise<OperationSourceResult> {
  // `runOperation` canonicalized the target already; doing it again is a no-op
  // and keeps a direct caller of this executor addressing the same path
  // dispatch would have.
  let target = canonicalizeTarget(core, request.target);
  let url = instanceTargetURL({ ...request, target });
  let localPath = localPathFor(core, url);
  let file = await core.openStoredFile(localPath);
  if (!file) {
    // One refusal for every way there is nothing to read: no such path, a
    // directory, or a path the realm declines to serve at all. The realm
    // applies its own refusals inside `openStoredFile`, so a `_`-prefixed
    // realm endpoint lands here the same way a missing file does, which is
    // what the byte routes answer for one.
    //
    // Never `target-not-indexed`. That code says waiting will resolve the
    // absence, and it is the index it is waiting for; the bytes either exist
    // or they do not, and a read of them has nothing to wait for.
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `${url.href} does not exist in realm ${core.realmURL}`,
    });
  }
  // `file.path` rather than the requested path: they are the same here, since
  // the facade resolved any fallback before dispatching, but the content type
  // has to describe the bytes that actually arrived rather than the name they
  // were asked for.
  let contentType = inferContentType(file.path);
  let meta = await core.storedFileMeta(localPath);
  let result: OperationSourceResult = {
    contentType,
    lastModified: file.lastModified,
    created: meta.createdAt ?? null,
    version: meta.version ?? null,
  };
  if (opts.headersOnly) {
    return result;
  }
  return { ...result, body: file.content };
}
