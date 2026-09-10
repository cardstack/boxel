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
// bytes. Where `read` serves the realm's indexed view of a target, assembled
// from the search index, this serves the representation the realm's byte
// routes serve — the `card+source` `GET`/`HEAD` and the raw byte serve.
//
// Two things separate it from `read`, and both come from what it serves:
//
//   * It consults no definition. `read` needs a type's definition to assemble
//     a document; bytes need only a path, so a definition cannot change what
//     this answers. Dispatch resolves the name before it would read one — see
//     `DEFINITION_FREE_OPERATIONS` for what that buys and what it rests on —
//     and this executor asks for none.
//
//   * It touches the index not at all. There is no row to peek and no
//     generation to join on, so it costs one file open and one file-meta row
//     — never a search read. That is also why it can answer for a path the
//     index has no row for, and for one it never will. Where the realm has no
//     recorded hash it reads the file to fingerprint it, in ranges bounded by
//     the fingerprint's own shape rather than by the file's size — so this
//     answers for a path of any size at a cost that does not grow with it.
//
// Two modes, as `read` has:
//
//   * bytes   — the metadata plus `body`.
//   * headers — the same metadata with no `body`, for a `HEAD` or for a
//               conditional `GET` deciding on a validator. It leaves the
//               adapter's `content` untouched rather than reading and
//               discarding it, which matters concretely: `content` is a lazy
//               getter that opens a real stream on first touch, so touching it
//               to throw it away would strand one. Every value it reports is
//               therefore identical to the one the other mode reports for the
//               same handle, `version` included — a fingerprint is read in
//               bounded ranges of its own rather than out of the body, so
//               neither mode pays for the other's and the two cannot
//               disagree about what a validator identifies.
//
// What stays outside, and what a facade routing here has to keep:
//
//   * The redirects. An extension-less URL naming `foo.gts`, or a card id
//     naming its `.json`, is resolved by the facade — this executor takes the
//     resolved path and reads it. A read has no redirect to give.
//   * The response around the bytes. `Last-Modified`, `x-created`, the
//     validator, the 304 and the source cache are all the facade's, computed
//     from what comes back here. Which validator is the facade's choice too,
//     and the byte routes do not make one choice: the source route builds an
//     `ETag` from a content hash for a `.json` or an executable extension, and
//     from `lastModified` for everything else, computing no hash at all on
//     that second path. Both members are here for either choice — a content
//     identity for every path, whether or not the route serving it asks for
//     one, since reading it is bounded and withholding it would only narrow
//     what a facade can validate on. A `Range` needs more than this result
//     carries — the adapter's bounded-read capability does not travel through
//     it — so a facade serving 206s holds the handle itself.
//
//   * The pairing of `lastModified` with the bytes. It is the stat taken when
//     the handle opened, and a streamed body is read from that handle later,
//     so a write landing in between pairs one with the other — exactly as it
//     does for the byte routes reading the same handle. `version` sits in the
//     same window and narrows it the two ways it can: a recorded hash is
//     reported only for a file of the size this handle stat'd, and a
//     fingerprint read from the file is abandoned rather than reported if the
//     ranges it reads no longer add up to that size.
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
  // dispatch would have — including the addressing, since a stored-bytes read
  // names a path and the realm root is that realm's directory rather than its
  // index card.
  let target = canonicalizeTarget(core, request.target, {
    rootNamesIndexCard: false,
  });
  let url = instanceTargetURL({ ...request, target });
  let localPath = localPathFor(core, url);
  let file = await core.openStoredFile(localPath);
  if (!file) {
    // One refusal for every way there is nothing to read: no such path, a
    // directory, or a path the realm declines to serve at all. The realm
    // applies its own refusals inside `openStoredFile`, so whichever of those
    // it was arrives here the same way.
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
  // Everything below describes `file.path`, not the path that was asked for.
  // They are the same here, since the facade resolves any fallback before
  // dispatching, but a result has to describe the bytes that actually arrived
  // rather than the name they were requested under — and it has to pick one of
  // the two for all of its members, or a fallback would leave the content type
  // describing one file and the version another.
  let servedPath = file.path;
  // The handle goes with the request, not just its path: the realm checks its
  // recorded hash against this handle's size, and reads bounded ranges of this
  // handle where it has to fingerprint the file itself.
  let meta = await core.storedFileMeta(servedPath, file);
  let result: OperationSourceResult = {
    contentType: inferContentType(servedPath),
    lastModified: file.lastModified,
    created: meta.createdAt ?? null,
    version: meta.version ?? null,
    size: file.size ?? null,
  };
  if (opts.headersOnly) {
    return result;
  }
  // The first and only touch of `content`, which is where a streaming adapter
  // opens its stream.
  return { ...result, body: file.content };
}
